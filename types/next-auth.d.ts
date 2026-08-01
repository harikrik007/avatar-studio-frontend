import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    clientId: string;
    companyName: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    clientId?: string;
    companyName?: string | null;
  }
}
