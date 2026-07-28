import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { loginSchema } from "@/lib/validations/user";
import { Role } from "@/lib/domain/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      farmId: string;
      role: Role;
      name: string;
      email: string;
    };
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const user = await db.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user || !user.isActive) return null;
        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;
        await db.auditLog.create({
          data: {
            farmId: user.farmId,
            userId: user.id,
            action: "LOGIN",
            entityType: "User",
            entityId: user.id,
            summary: `${user.name} signed in`,
          },
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          farmId: user.farmId,
          role: user.role as Role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        // @ts-expect-error custom fields from authorize()
        token.farmId = user.farmId;
        // @ts-expect-error custom fields from authorize()
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.farmId = token.farmId as string;
      session.user.role = token.role as Role;
      return session;
    },
  },
});

export interface Ctx {
  userId: string;
  farmId: string;
  role: Role;
  userName: string;
}

/** Resolve the authenticated service context or throw. Call at top of every server action. */
export async function requireCtx(): Promise<Ctx> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  return {
    userId: session.user.id,
    farmId: session.user.farmId,
    role: session.user.role,
    userName: session.user.name,
  };
}
