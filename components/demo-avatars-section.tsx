"use client";

import { useEffect, useRef, useState } from "react";
import { Track, type RemoteTrack } from "livekit-client";
import { LiveKitFace } from "@/components/livekit-face";
import { AvatarSession, type AvatarToolCall } from "@/lib/avatar-session";

type DemoAgent = {
  key: string; // embed public_key, seeded via scripts/seed_pizza.py / seed_bank.py / seed_ringme.py
  name: string;
  business: string;
  blurb: string;
  idleVideoSrc: string; // each avatar's own idle loop -- LiveKitFace's default is a single generic clip
  kind: "pizza" | "bank" | "ringme"; // picks which tool-call handler below answers this card's calls
};

// All three are real, box-hosted deployments (never RunPod) -- seeded into
// Avatar Studio's own DB the same way scripts/seed_ringme.py already did,
// so this section is just another (first-party) consumer of the real
// embed-widget backend, not a special path.
const DEMO_AGENTS: DemoAgent[] = [
  {
    key: "pk_e92d071807d94962b7dd660eead4afe2",
    name: "Chef Mozza",
    business: "Pizza Orbit",
    blurb: "Order pizza, ask about the menu, get delivery help.",
    idleVideoSrc: "/pizza-idle-loop.webm",
    kind: "pizza",
  },
  {
    key: "pk_955115ca0514429ebd62c6cf2ef9d370",
    name: "Mira",
    business: "central Bank",
    blurb: "Check balances, ask about products, get account help.",
    idleVideoSrc: "/bank-idle-loop.webm",
    kind: "bank",
  },
  {
    key: "pk_02e0307e97d74dd086602ea4c618bef4",
    name: "RingMe Assistant",
    business: "RingMe",
    blurb: "Customer care for RingMe's own callers.",
    idleVideoSrc: "/ringme-idle-loop.webm",
    kind: "ringme",
  },
];

// Mirrors central Bank's own demo data + PIN check (bank/lib/ringme-content.ts,
// bank/components/voice-assistant-demo.tsx's executeToolCall) -- kept as a
// separate, smaller copy here rather than shared, since this is the one
// place check_balance/get_account_details/download_statement need to behave
// for real instead of the "Not available in this demo" stub every other
// tool call gets. Real bank.agentbaba.ai is untouched by this.
const BANK_DEMO_PIN = "4321";
const BANK_ACCOUNTS = [
  {
    id: "primary-savings",
    type: "Savings",
    nickname: "Primary Savings",
    holderName: "Arun Kumar",
    accountNumberMasked: "XXXXXX4821",
    ifsc: "FDRL0001234",
    branch: "Kochi MG Road",
    availableBalance: 128450.75,
    ledgerBalance: 129100.75,
  },
  {
    id: "family-current",
    type: "Current",
    nickname: "Family Current",
    holderName: "Arun Kumar",
    accountNumberMasked: "XXXXXX9037",
    ifsc: "FDRL0005678",
    branch: "Bengaluru Indiranagar",
    availableBalance: 86320.2,
    ledgerBalance: 87320.2,
  },
];
const BANK_STATEMENTS = [
  { id: "jun-2026", label: "June 2026 Statement", period: "01 Jun 2026 - 30 Jun 2026" },
  { id: "may-2026", label: "May 2026 Statement", period: "01 May 2026 - 31 May 2026" },
];

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeToken(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function resolveBankAccount(args: Record<string, unknown>) {
  const accountId = normalizeToken(String(args.accountId ?? ""));
  const accountType = normalizeToken(String(args.accountType ?? ""));
  return (
    BANK_ACCOUNTS.find((a) => normalizeToken(a.id) === accountId) ??
    BANK_ACCOUNTS.find((a) => normalizeToken(a.type) === accountType) ??
    BANK_ACCOUNTS[0]
  );
}

function resolveBankStatement(statementId: unknown) {
  const id = normalizeToken(String(statementId ?? ""));
  return BANK_STATEMENTS.find((s) => normalizeToken(s.id) === id) ?? BANK_STATEMENTS[0];
}

function executeBankToolCall(call: AvatarToolCall): Record<string, unknown> {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const account = resolveBankAccount(args);

  if (call.name === "check_balance") {
    const pin = typeof args.pin === "string" ? args.pin.trim() : "";
    if (!pin) {
      return {
        success: false,
        requiresPin: true,
        customerMessage: "Please tell me the demo PIN so I can check your balance.",
      };
    }
    if (pin !== BANK_DEMO_PIN) {
      return {
        success: false,
        requiresPin: true,
        customerMessage: "That PIN doesn't match our demo account. The demo PIN is 4321.",
      };
    }
    return {
      success: true,
      accountId: account.id,
      availableBalance: account.availableBalance,
      ledgerBalance: account.ledgerBalance,
      customerMessage: `${account.nickname} available balance is ${formatInr(account.availableBalance)} and ledger balance is ${formatInr(account.ledgerBalance)}.`,
    };
  }

  if (call.name === "get_account_details") {
    return {
      success: true,
      account: {
        id: account.id,
        type: account.type,
        nickname: account.nickname,
        holderName: account.holderName,
        accountNumberMasked: account.accountNumberMasked,
        ifsc: account.ifsc,
        branch: account.branch,
      },
      customerMessage: `${account.nickname} is your ${account.type.toLowerCase()} account ending ${account.accountNumberMasked.slice(-4)}. IFSC is ${account.ifsc} and branch is ${account.branch}.`,
    };
  }

  if (call.name === "download_statement") {
    const statement = resolveBankStatement(args.statementId);
    return {
      success: true,
      statement: { id: statement.id, label: statement.label, period: statement.period },
      customerMessage: `${statement.label} is ready for ${account.nickname}. Statement downloads aren't available in this demo, but they work on the live site.`,
    };
  }

  return { success: false, error: "Not available in this demo." };
}

function executeRingmeToolCall(call: AvatarToolCall): Record<string, unknown> {
  if (call.name === "save_contact_details") {
    const args = (call.args ?? {}) as Record<string, unknown>;
    const name = typeof args.name === "string" ? args.name.trim() : "";
    return {
      success: true,
      customerMessage: name
        ? `Thanks ${name}, I've saved your details.`
        : "Thanks, I've saved your details.",
    };
  }
  return { success: false, error: "Not available in this demo." };
}

// Mirrors Pizza Orbit's own demo menu + cart logic
// (pizza_wav2lip_client/lib/ringme-content.ts, .../components/voice-
// assistant-demo.tsx's executeToolCall/addItemToCart/removeFromCart) so
// add_to_cart/remove_from_cart/view_cart/calculate_cart_total answer for
// real instead of the stub -- Chef Mozza's own system prompt explicitly
// says "never say an item was added, removed, or totaled unless the tool
// response confirms it," so a stubbed failure was making her stall and
// then confirm anyway, contradicting her own instructions. Cart state
// lives in a ref on the section component (see cartRef below), reset each
// time a fresh Pizza session starts. Real pizza3.agentbaba.ai is untouched.
type PizzaMenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: "Veg" | "Chicken" | "Classic";
  aliases: string[];
};
type PizzaAddition = { id: string; name: string; price: number };
type PizzaCartLine = { id: string; item: PizzaMenuItem; quantity: number; additions: PizzaAddition[] };

const PIZZA_ADDITIONS: PizzaAddition[] = [
  { id: "extra-cheese", name: "Extra Cheese", price: 70 },
  { id: "stuffed-crust", name: "Stuffed Crust", price: 120 },
  { id: "olives", name: "Black Olives", price: 55 },
  { id: "jalapenos", name: "Jalapenos", price: 45 },
  { id: "mushrooms", name: "Sauteed Mushrooms", price: 60 },
  { id: "paneer", name: "Paneer Cubes", price: 90 },
  { id: "chicken", name: "Smoked Chicken", price: 110 },
  { id: "burrata", name: "Burrata Finish", price: 150 },
];

const PIZZA_MENU: PizzaMenuItem[] = [
  { id: "margherita-melt", name: "Margherita Melt", description: "San Marzano tomato sauce, mozzarella, basil ribbons, and garlic oil.", price: 249, category: "Classic", aliases: ["margherita", "margarita", "margherita pizza", "margarita pizza", "melt"] },
  { id: "farmhouse-crunch", name: "Farmhouse Crunch", description: "Onion, capsicum, tomato, sweet corn, and oregano crust dust.", price: 289, category: "Veg", aliases: ["farmhouse", "veggie farmhouse"] },
  { id: "tandoori-paneer-fire", name: "Tandoori Paneer Fire", description: "Smoky paneer tikka, red onion, mint drizzle, and roasted peppers.", price: 359, category: "Veg", aliases: ["tandoori paneer", "paneer fire"] },
  { id: "pepperoni-feast", name: "Pepperoni Feast", description: "Crisped pepperoni, mozzarella, tomato sauce, and parmesan snow.", price: 379, category: "Classic", aliases: ["pepperoni", "feast"] },
  { id: "corn-cheese-carnival", name: "Corn Cheese Carnival", description: "Sweet corn, stretchy cheese, herb butter, and chili flakes.", price: 279, category: "Veg", aliases: ["corn cheese", "carnival"] },
  { id: "bbq-chicken-burst", name: "BBQ Chicken Burst", description: "BBQ chicken, caramelized onions, mozzarella, and smoky drizzle.", price: 389, category: "Chicken", aliases: ["bbq chicken", "burst"] },
  { id: "spicy-desi-tikka-blast", name: "Spicy Desi Tikka Blast", description: "Fiery tikka sauce, paneer, onion, green chili, and coriander.", price: 369, category: "Veg", aliases: ["desi tikka", "tikka blast"] },
  { id: "mushroom-truffle-pop", name: "Mushroom Truffle Pop", description: "Roasted mushrooms, mozzarella, cream sauce, and truffle finish.", price: 399, category: "Veg", aliases: ["mushroom truffle", "truffle pop"] },
  { id: "peri-peri-veggie", name: "Peri Peri Veggie", description: "Peri peri sauce, peppers, onion, corn, olives, and chili oil.", price: 329, category: "Veg", aliases: ["peri peri veggie", "peri veggie"] },
  { id: "classic-cheese-overload", name: "Classic Cheese Overload", description: "Mozzarella, cheddar, gouda blend, and bubbling cheese crust.", price: 319, category: "Classic", aliases: ["cheese overload", "cheese pizza"] },
  { id: "fiery-chicken-mexicana", name: "Fiery Chicken Mexicana", description: "Spiced chicken, jalapenos, corn salsa, paprika, and chipotle mayo.", price: 409, category: "Chicken", aliases: ["mexicana", "fiery chicken"] },
  { id: "garden-pesto-swirl", name: "Garden Pesto Swirl", description: "Pesto base, cherry tomato, zucchini, feta, and basil crunch.", price: 349, category: "Veg", aliases: ["pesto", "garden pesto"] },
  { id: "double-chicken-cheddar", name: "Double Chicken Cheddar", description: "Grilled chicken, cheddar glaze, onion jam, and herb crust.", price: 429, category: "Chicken", aliases: ["double chicken", "cheddar chicken"] },
  { id: "olive-sunburst", name: "Olive Sunburst", description: "Black olives, roasted garlic, tomato confit, and mozzarella.", price: 309, category: "Veg", aliases: ["olive", "sunburst"] },
  { id: "paneer-makhani-dream", name: "Paneer Makhani Dream", description: "Makhani sauce, paneer, capsicum, onion, and cream swirl.", price: 379, category: "Veg", aliases: ["paneer makhani", "makhani dream"] },
  { id: "devils-pepperoni", name: "Devil's Pepperoni", description: "Pepperoni, chili honey, hot sauce, red chili, and pecorino.", price: 419, category: "Classic", aliases: ["devils pepperoni", "hot pepperoni"] },
  { id: "garlic-alfredo-chicken", name: "Garlic Alfredo Chicken", description: "Creamy alfredo, garlic chicken, spinach, and parmesan rain.", price: 399, category: "Chicken", aliases: ["alfredo chicken", "garlic chicken"] },
  { id: "veggie-supreme-stack", name: "Veggie Supreme Stack", description: "Mushroom, peppers, onion, olives, corn, and tomato basil sauce.", price: 339, category: "Veg", aliases: ["veggie supreme", "supreme stack"] },
  { id: "smoked-sausage-street", name: "Smoked Sausage Street", description: "Smoked sausage, bell pepper, onion, mozzarella, and mustard glaze.", price: 389, category: "Classic", aliases: ["sausage", "smoked sausage"] },
  { id: "burrata-blaze", name: "Burrata Blaze", description: "Cherry tomato sauce, fresh burrata, basil pesto, and chili crisp.", price: 449, category: "Veg", aliases: ["burrata", "blaze"] },
];

function formatInrWhole(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function findPizzaByName(name: string): PizzaMenuItem | null {
  const normalized = normalizeToken(name);
  return (
    PIZZA_MENU.find((item) => normalizeToken(item.id) === normalized) ??
    PIZZA_MENU.find((item) => normalizeToken(item.name) === normalized) ??
    PIZZA_MENU.find((item) => item.aliases.some((a) => normalizeToken(a) === normalized)) ??
    PIZZA_MENU.find((item) => normalizeToken(item.name).includes(normalized)) ??
    PIZZA_MENU.find((item) => item.aliases.some((a) => normalizeToken(a).includes(normalized))) ??
    null
  );
}

function findAdditionIds(names: string[]): string[] {
  const resolved = new Set<string>();
  for (const raw of names) {
    const normalized = normalizeToken(raw);
    const addition = PIZZA_ADDITIONS.find(
      (a) => normalizeToken(a.name) === normalized || normalizeToken(a.name).includes(normalized)
    );
    if (addition) resolved.add(addition.id);
  }
  return [...resolved];
}

function getAdditionKey(additions: PizzaAddition[]) {
  return additions.map((a) => a.id).sort().join("|");
}

function getLineTotal(basePrice: number, additions: PizzaAddition[], quantity: number) {
  return (basePrice + additions.reduce((t, a) => t + a.price, 0)) * quantity;
}

function clampQuantity(value: number) {
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function buildCartSnapshot(cart: PizzaCartLine[]) {
  const totalItems = cart.reduce((t, e) => t + e.quantity, 0);
  const subtotal = cart.reduce((t, e) => t + getLineTotal(e.item.price, e.additions, e.quantity), 0);
  return {
    totalItems,
    subtotal,
    subtotalFormatted: formatInrWhole(subtotal),
    lines: cart.map((e) => ({
      pizzaName: e.item.name,
      quantity: e.quantity,
      additions: e.additions.map((a) => a.name),
      lineTotalFormatted: formatInrWhole(getLineTotal(e.item.price, e.additions, e.quantity)),
    })),
  };
}

// Returns the tool response plus the cart's next state; the caller
// (handleToolCalls) writes that back to cartRef -- kept as a pure function
// here so it's easy to reason about, unlike the real pizza frontend's
// version which mutates component state directly.
function executePizzaToolCall(
  call: AvatarToolCall,
  cart: PizzaCartLine[]
): { response: Record<string, unknown>; nextCart: PizzaCartLine[] } {
  const args = (call.args ?? {}) as Record<string, unknown>;

  if (call.name === "list_menu") {
    const rawCategory = typeof args.category === "string" ? args.category : "";
    const category = (["Veg", "Chicken", "Classic"] as const).includes(rawCategory as never)
      ? (rawCategory as PizzaMenuItem["category"])
      : null;
    const items = category ? PIZZA_MENU.filter((i) => i.category === category) : PIZZA_MENU;
    return {
      nextCart: cart,
      response: {
        success: true,
        category: category ?? "All",
        itemCount: items.length,
        menu: items.map((i) => ({ name: i.name, category: i.category, price: i.price, priceFormatted: formatInrWhole(i.price), description: i.description })),
        customerMessage: category ? `Here are the ${category} pizzas.` : "Here is the full pizza menu.",
      },
    };
  }

  if (call.name === "add_to_cart") {
    const pizzaName = typeof args.pizzaName === "string" ? args.pizzaName.trim() : "";
    if (!pizzaName) {
      return { nextCart: cart, response: { success: false, error: "Missing pizza name.", customerMessage: "Please tell me which pizza you'd like to add." } };
    }
    const item = findPizzaByName(pizzaName);
    if (!item) {
      return { nextCart: cart, response: { success: false, error: `Pizza not found: ${pizzaName}`, customerMessage: `I couldn't match ${pizzaName} on the menu.` } };
    }
    const quantity = clampQuantity(typeof args.quantity === "number" ? args.quantity : 1);
    const additionNames = Array.isArray(args.additions) ? args.additions.filter((a): a is string => typeof a === "string") : [];
    const additionIds = findAdditionIds(additionNames);
    const additions = PIZZA_ADDITIONS.filter((a) => additionIds.includes(a.id));
    const additionKey = getAdditionKey(additions);

    const nextCart = [...cart];
    const existingIndex = nextCart.findIndex((e) => e.item.id === item.id && getAdditionKey(e.additions) === additionKey);
    if (existingIndex === -1) {
      nextCart.push({ id: `${item.id}-${Date.now()}`, item, quantity, additions });
    } else {
      nextCart[existingIndex] = { ...nextCart[existingIndex], quantity: nextCart[existingIndex].quantity + quantity };
    }

    return {
      nextCart,
      response: {
        success: true,
        added: { pizzaName: item.name, quantity, additions: additions.map((a) => a.name) },
        cart: buildCartSnapshot(nextCart),
        customerMessage: `Added ${quantity} ${item.name}${additions.length ? ` with ${additions.map((a) => a.name).join(", ")}` : ""}.`,
      },
    };
  }

  if (call.name === "remove_from_cart") {
    const pizzaName = typeof args.pizzaName === "string" ? args.pizzaName.trim() : "";
    if (!pizzaName) {
      return { nextCart: cart, response: { success: false, error: "Missing pizza name.", customerMessage: "Please tell me which pizza to remove." } };
    }
    const item = findPizzaByName(pizzaName);
    if (!item) {
      return { nextCart: cart, response: { success: false, error: `Pizza not found: ${pizzaName}`, customerMessage: `I couldn't match ${pizzaName} on the menu.` } };
    }
    const requestedQuantity = typeof args.quantity === "number" && args.quantity > 0 ? Math.floor(args.quantity) : Infinity;
    const matchingCount = cart.reduce((t, e) => (e.item.id === item.id ? t + e.quantity : t), 0);
    if (!matchingCount) {
      return { nextCart: cart, response: { success: false, error: `${item.name} is not in the cart.`, cart: buildCartSnapshot(cart), customerMessage: `${item.name} is not in the order yet.` } };
    }
    let remaining = requestedQuantity;
    const nextCart: PizzaCartLine[] = [];
    for (const entry of cart) {
      if (entry.item.id !== item.id || remaining <= 0) {
        nextCart.push(entry);
        continue;
      }
      if (remaining === Infinity || entry.quantity <= remaining) {
        remaining = remaining === Infinity ? Infinity : remaining - entry.quantity;
        continue;
      }
      nextCart.push({ ...entry, quantity: entry.quantity - remaining });
      remaining = 0;
    }
    const removedQuantity = requestedQuantity === Infinity ? matchingCount : Math.min(matchingCount, requestedQuantity);

    return {
      nextCart,
      response: {
        success: true,
        removed: { pizzaName: item.name, quantity: removedQuantity },
        cart: buildCartSnapshot(nextCart),
        customerMessage: `Removed ${removedQuantity} ${item.name}.`,
      },
    };
  }

  if (call.name === "view_cart" || call.name === "calculate_cart_total") {
    const snapshot = buildCartSnapshot(cart);
    return {
      nextCart: cart,
      response: {
        success: true,
        cart: snapshot,
        customerMessage: snapshot.totalItems
          ? `Cart subtotal is ${snapshot.subtotalFormatted} for ${snapshot.totalItems} item${snapshot.totalItems === 1 ? "" : "s"}.`
          : "The cart is empty right now.",
      },
    };
  }

  return { nextCart: cart, response: { success: false, error: "Not available in this demo." } };
}

type CardStatus =
  | "idle"
  | "checking"
  | "queued"
  | "connecting"
  | "listening"
  | "error"
  | "ended";

// A visitor who opens a demo and wanders off must not hold one of a small,
// shared, four-slot pool that each business's own real customers also draw
// from -- same reasoning as embed-widget.tsx.
const IDLE_TIMEOUT_MS = 90_000;
// Deliberately shorter than the real embed widget's 8-minute cap: a
// marketing demo doesn't need a long conversation to prove quality, and a
// short, predictable cap is what makes the queue below actually move.
const DEMO_HARD_TIMEOUT_MS = 3 * 60_000;
const DEMO_WARNING_MS = DEMO_HARD_TIMEOUT_MS - 30_000;
const QUEUE_POLL_MS = 4_000;

export function DemoAvatarsSection() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoTrack, setVideoTrack] = useState<RemoteTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<RemoteTrack | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [endingSoon, setEndingSoon] = useState(false);

  const sessionRef = useRef<AvatarSession | null>(null);
  const roomNameRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const busyRef = useRef(false); // guards against a double-click across cards firing two connects
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pizzaCartRef = useRef<PizzaCartLine[]>([]); // reset per fresh Pizza session, see beginConnect

  function setCardStatus(key: string, status: CardStatus) {
    setStatuses((prev) => ({ ...prev, [key]: status }));
  }

  function clearTimers() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (hardTimerRef.current) clearTimeout(hardTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    idleTimerRef.current = null;
    hardTimerRef.current = null;
    warnTimerRef.current = null;
  }

  function clearQueuePoll() {
    if (queuePollRef.current) {
      clearInterval(queuePollRef.current);
      queuePollRef.current = null;
    }
  }

  function armIdleTimer() {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => void endSession("idle_timeout"), IDLE_TIMEOUT_MS);
  }

  useEffect(() => {
    return () => {
      clearTimers();
      clearQueuePoll();
      if (sessionRef.current) void endSession("visitor_closed");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function endSession(
    reason: "visitor_closed" | "idle_timeout" | "hard_timeout",
    uiStatus?: CardStatus
  ) {
    clearTimers();
    clearQueuePoll();
    const key = activeKeyRef.current;
    const room = roomNameRef.current;
    sessionRef.current?.close();
    sessionRef.current = null;
    roomNameRef.current = null;
    activeKeyRef.current = null;
    setActiveKey(null);
    setVideoTrack(null);
    setAudioTrack(null);
    setIsSpeaking(false);
    setEndingSoon(false);

    if (room && key) {
      try {
        await fetch("/api/embed/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_key: key, room, reason }),
        });
      } catch {
        // Best-effort -- the control plane's own empty-room monitor reaps it regardless.
      }
    }
    if (key) {
      setCardStatus(
        key,
        uiStatus ?? (reason === "idle_timeout" || reason === "hard_timeout" ? "ended" : "idle")
      );
    }
  }

  function handleToolCalls(calls: AvatarToolCall[]) {
    // Bank's check_balance/get_account_details/download_statement, RingMe's
    // save_contact_details, and Pizza's add_to_cart/remove_from_cart/
    // view_cart/calculate_cart_total all answer for real now (see the
    // execute*ToolCall functions above) instead of the blanket stub.
    if (!calls.length || !sessionRef.current) return;
    const kind = DEMO_AGENTS.find((a) => a.key === activeKeyRef.current)?.kind;

    let responses: { id?: string; name?: string; response: Record<string, unknown> }[];
    if (kind === "pizza") {
      // Processed in order (not calls.map) so a batch like
      // [add_to_cart, view_cart] sees the cart update in between, matching
      // how the real pizza frontend's cartItemsRef mutation behaves.
      let cart = pizzaCartRef.current;
      responses = calls.map((call) => {
        const { response, nextCart } = executePizzaToolCall(call, cart);
        cart = nextCart;
        return { id: call.id, name: call.name, response };
      });
      pizzaCartRef.current = cart;
    } else {
      responses = calls.map((call) => ({
        id: call.id,
        name: call.name,
        response:
          kind === "bank"
            ? executeBankToolCall(call)
            : kind === "ringme"
              ? executeRingmeToolCall(call)
              : { success: false, error: "Not available in this demo." },
      }));
    }

    sessionRef.current.sendToolResponse({ functionResponses: responses });
  }

  async function beginConnect(agent: DemoAgent) {
    if (activeKeyRef.current && activeKeyRef.current !== agent.key) {
      await endSession("visitor_closed");
    }
    clearQueuePoll();
    setErrorMessage(null);
    setCardStatus(agent.key, "connecting");
    setTranscript("Connecting…");
    if (agent.kind === "pizza") pizzaCartRef.current = [];

    const session = await AvatarSession.connect(
      {
        onToolCall: handleToolCalls,
        onTranscript: (_role, text) => {
          armIdleTimer();
          const trimmed = text.trim();
          if (trimmed) setTranscript(trimmed);
        },
        onSpeakingChange: (speaking) => {
          armIdleTimer();
          setIsSpeaking(speaking);
        },
        onTrack: (track) => {
          if (track.kind === Track.Kind.Video) setVideoTrack(track);
          else if (track.kind === Track.Kind.Audio) setAudioTrack(track);
        },
        onAudioBlocked: setAudioBlocked,
        onDisconnected: () => void endSession("visitor_closed"),
        onError: (message) => {
          setErrorMessage(message);
          void endSession("visitor_closed", "error");
        },
      },
      {
        sessionUrl: "/api/embed/session",
        sessionBody: { public_key: agent.key, origin: window.location.origin },
      }
    );

    sessionRef.current = session;
    roomNameRef.current = session.room.name;
    activeKeyRef.current = agent.key;
    setActiveKey(agent.key);
    setAudioBlocked(!session.canPlaybackAudio);
    setCardStatus(agent.key, "listening");
    setTranscript(`Say hello to ${agent.name}.`);
    armIdleTimer();
    hardTimerRef.current = setTimeout(() => void endSession("hard_timeout"), DEMO_HARD_TIMEOUT_MS);
    warnTimerRef.current = setTimeout(() => setEndingSoon(true), DEMO_WARNING_MS);
  }

  function enterQueue(key: string) {
    setCardStatus(key, "queued");
    clearQueuePoll();
    queuePollRef.current = setInterval(async () => {
      const agent = DEMO_AGENTS.find((a) => a.key === key);
      if (!agent) return;
      try {
        const capRes = await fetch(`/api/embed/capacity/${key}`);
        const cap = (await capRes.json()) as { available?: boolean };
        if (cap.available === false) return; // keep polling
        clearQueuePoll();
        try {
          await beginConnect(agent);
        } catch {
          // Lost the race to another visitor between the poll and connect --
          // this is the one place a real server-side queue would have
          // guaranteed a turn; here it just resumes polling instead of
          // showing a dead end.
          enterQueue(key);
        }
      } catch {
        // Network hiccup -- keep polling.
      }
    }, QUEUE_POLL_MS);
  }

  async function startDemo(agent: DemoAgent) {
    if (busyRef.current) return;
    busyRef.current = true;
    setCardStatus(agent.key, "checking");
    try {
      const capRes = await fetch(`/api/embed/capacity/${agent.key}`);
      const cap = (await capRes.json()) as { available?: boolean };
      if (cap.available === false) {
        enterQueue(agent.key);
        return;
      }
    } catch {
      // Fail open on the display check -- the real gate is server-side in beginConnect.
    }
    try {
      await beginConnect(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/busy|capacity/i.test(message)) {
        enterQueue(agent.key);
      } else {
        setCardStatus(agent.key, "error");
        setErrorMessage(message || "Unable to start the conversation.");
      }
    } finally {
      busyRef.current = false;
    }
  }

  function cancelQueue(key: string) {
    clearQueuePoll();
    setCardStatus(key, "idle");
  }

  // The connected card becomes the visual focus: it moves into the center
  // grid slot (order 1 of 3) via CSS `order`, not by reordering the DOM --
  // reordering the actual elements would remount LiveKitFace's <video>,
  // interrupting the live track. The other two keep their original
  // relative order on whichever side is left, so a second card taking
  // focus doesn't also shuffle which side the first one recedes to.
  const activeIndex = activeKey ? DEMO_AGENTS.findIndex((a) => a.key === activeKey) : -1;
  function cardOrder(index: number, focusIndex: number): number {
    if (focusIndex === -1) return index;
    if (index === focusIndex) return 1;
    const others = DEMO_AGENTS.map((_, i) => i).filter((i) => i !== focusIndex);
    return others.indexOf(index) === 0 ? 0 : 2;
  }

  return (
    <section className="l-section" id="try-avatars">
      <div className="l-section-title l-center">
        <span className="l-kicker">Try it live</span>
        <h2>Talk to a real avatar, right now</h2>
        <p>
          Three working agents, live on our own GPU box — no signup, no
          waiting for a demo call.
        </p>
      </div>

      <div className="l-demo-grid">
        {DEMO_AGENTS.map((agent, index) => {
          const status = statuses[agent.key] ?? "idle";
          const isActive = activeKey === agent.key;

          return (
            <div
              className={`l-demo-card${isActive ? " l-demo-card-focused" : activeKey ? " l-demo-card-receded" : ""}`}
              style={{ order: cardOrder(index, activeIndex) }}
              key={agent.key}
            >
              <div className="l-demo-stage">
                <LiveKitFace
                  videoTrack={isActive ? videoTrack : null}
                  audioTrack={isActive ? audioTrack : null}
                  isConnected={isActive && status === "listening"}
                  width={220}
                  height={260}
                  idleVideoSrc={agent.idleVideoSrc}
                />
                {isActive && isSpeaking ? <span className="l-demo-speaking-dot" /> : null}
              </div>

              <h3>{agent.name}</h3>
              <p className="l-demo-business">{agent.business}</p>
              <p className="l-demo-blurb">{agent.blurb}</p>

              {isActive ? (
                <>
                  <p className="l-demo-transcript">{transcript}</p>
                  {endingSoon ? <p className="l-demo-warning">Ending in 30s…</p> : null}
                  {audioBlocked ? (
                    <button
                      type="button"
                      className="l-btn l-btn-ghost"
                      onClick={() =>
                        void sessionRef.current?.startAudio().then((ok) => setAudioBlocked(!ok))
                      }
                    >
                      Enable sound
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="l-btn l-btn-primary"
                    onClick={() => void endSession("visitor_closed")}
                  >
                    End conversation
                  </button>
                </>
              ) : status === "queued" ? (
                <>
                  <p className="l-demo-transcript">You&apos;re in queue — waiting for a free seat…</p>
                  <button type="button" className="l-btn l-btn-ghost" onClick={() => cancelQueue(agent.key)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {status === "error" && errorMessage ? (
                    <p className="l-demo-error">{errorMessage}</p>
                  ) : null}
                  <button
                    type="button"
                    className="l-btn l-btn-primary"
                    disabled={status === "checking" || status === "connecting"}
                    onClick={() => void startDemo(agent)}
                  >
                    {status === "checking"
                      ? "Checking…"
                      : status === "connecting"
                        ? "Connecting…"
                        : status === "error"
                          ? "Try again"
                          : status === "ended"
                            ? "Start a new chat"
                            : "Start talking"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
