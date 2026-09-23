"use client";

import { useEffect, useRef } from "react";
import { Track, type RemoteTrack } from "livekit-client";

/**
 * Keys the avatar's green background out, on the GPU, so it can float on a
 * page instead of sitting in a rectangle.
 *
 * Transparency cannot arrive over the wire: VP8 and VP9 carry alpha only
 * inside a WebM container, and there is no RTP mapping for it, so every
 * WebRTC frame is opaque no matter what the renderer does. The alpha has
 * to be reconstructed here, which is why the avatar has to be built from a
 * green-screen image in the first place.
 *
 * The shader is Anam's own recipe. Per frame it uploads one texture, sets
 * four uniforms and draws one rectangle -- no getImageData, no per-pixel
 * JavaScript, which is the difference between this being free and this
 * being the reason a laptop's fan spins up.
 *
 * The video element stays in the DOM and keeps playing: it is both the
 * texture source and, for the LiveKit track, where the audio lives.
 */

type Props = {
  videoTrack: RemoteTrack | null;
  /** Not drawn -- the canvas never touches it -- but attached to a
   * document-level <audio> element the same way LiveKitFace does it, so
   * the avatar's voice plays regardless of which one is rendering her
   * face. Without this the frameless path was silent: it drew the video
   * track and never went near the audio one. */
  audioTrack?: RemoteTrack | null;
  /** Shown, keyed the same way, before a track exists. The avatar's own
   * green-screen still, so the idle state floats exactly like the live one
   * rather than turning back into a rectangle. */
  idleImageSrc?: string | null;
  className?: string;
  style?: React.CSSProperties;
};

// Anam's defaults. Named rather than inlined because tuning these is the
// documented way to chase fringing on a particular avatar.
const MIN_GREEN = 90;
const GREEN_BIAS = 1.15;
const SOFTNESS = 28;
const SPILL = 0.45;

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_source;
uniform float u_minGreen;
uniform float u_greenBias;
uniform float u_softness;
uniform float u_spill;

varying vec2 v_texCoord;

void main() {
  vec4 texel = texture2D(u_source, v_texCoord);
  float red = texel.r * 255.0;
  float green = texel.g * 255.0;
  float blue = texel.b * 255.0;
  float minChannel = min(red, min(green, blue));
  float maxRedBlue = max(red, blue);
  float maxChannel = max(red, max(green, blue));
  float saturation = maxChannel == 0.0 ? 0.0 : (maxChannel - minChannel) / maxChannel;
  float greenDominance = green - maxRedBlue;
  float keyRamp = max(8.0, u_softness * 0.55);
  bool isGreen =
    green == maxChannel &&
    green > u_minGreen &&
    green > red * u_greenBias &&
    green > blue * u_greenBias &&
    saturation > 0.08 &&
    greenDominance > 2.0;

  vec3 color = texel.rgb;
  float alpha = texel.a;

  if (isGreen) {
    float keyedAmount = clamp(
      (greenDominance - 2.0) / keyRamp + (saturation - 0.08) * 1.8, 0.0, 1.0);
    alpha = texel.a * (1.0 - keyedAmount);
  } else if (greenDominance > 8.0 && green > 70.0) {
    // Green spill on hair and shoulders, pulled back toward neutral.
    color.g = max(0.0, green - greenDominance * u_spill) / 255.0;
  }

  gl_FragColor = vec4(color, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[avatar-studio] shader failed", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function GreenScreenCanvas({ videoTrack, audioTrack, idleImageSrc, className, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Same attach LiveKitFace does for the panel path: a track's own
  // attach() builds the <audio> element and wires autoplay for us.
  // Attaching to our own element produced a silent track there too.
  useEffect(() => {
    if (!audioTrack || audioTrack.kind !== Track.Kind.Audio) return;
    const element = audioTrack.attach() as HTMLAudioElement;
    element.dataset.avatarAudio = "true";
    element.autoplay = true;
    element.muted = false;
    element.volume = 1;
    document.body.appendChild(element);
    void element.play().catch((error) => {
      console.warn("[avatar-studio] audio play() blocked", error);
    });
    return () => {
      audioTrack.detach(element);
      element.remove();
    };
  }, [audioTrack]);

  // The idle still, decoded once and kept as a texture source for whenever
  // there is no live frame to draw.
  useEffect(() => {
    if (!idleImageSrc) {
      imageRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous"; // a tainted canvas cannot be drawn from
    img.onload = () => { imageRef.current = img; };
    img.src = idleImageSrc;
    return () => { imageRef.current = null; };
  }, [idleImageSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoTrack || videoTrack.kind !== Track.Kind.Video) return;
    videoTrack.attach(video);
    return () => { videoTrack.detach(video); };
  }, [videoTrack]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
    if (!gl) {
      console.warn("[avatar-studio] no WebGL; avatar will render unkeyed");
      return;
    }

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Two triangles covering the canvas, with the texture flipped: WebGL's
    // origin is bottom-left and a video frame's is top-left.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0,
      -1, 1, 0, 0, 1, -1, 1, 1, 1, 1, 1, 0,
    ]), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(program, "a_position");
    const aTexCoord = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const uniforms = {
      minGreen: gl.getUniformLocation(program, "u_minGreen"),
      greenBias: gl.getUniformLocation(program, "u_greenBias"),
      softness: gl.getUniformLocation(program, "u_softness"),
      spill: gl.getUniformLocation(program, "u_spill"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const live = videoRef.current;
      const hasFrame = live && live.readyState >= 2 && live.videoWidth > 0;
      const source: TexImageSource | null = hasFrame ? live : imageRef.current;
      if (!source) return;

      const w = hasFrame ? live!.videoWidth : (source as HTMLImageElement).naturalWidth;
      const h = hasFrame ? live!.videoHeight : (source as HTMLImageElement).naturalHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform1f(uniforms.minGreen, MIN_GREEN);
      gl.uniform1f(uniforms.greenBias, GREEN_BIAS);
      gl.uniform1f(uniforms.softness, SOFTNESS);
      gl.uniform1f(uniforms.spill, SPILL);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className={className} style={style} />
      {/* Kept in the DOM and playing -- it is the texture source, and for a
          LiveKit track it is also where the audio comes from. Hidden rather
          than removed, since a detached video decodes nothing. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </>
  );
}
