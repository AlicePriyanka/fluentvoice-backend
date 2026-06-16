import { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { JwtPayload } from "./types";

const COOKIE_NAME = "fv_token";
const EXPIRES_IN = 60 * 60 * 24 * 7; // 7 days in seconds

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: Omit<JwtPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${EXPIRES_IN}s`)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

/** Read and verify JWT from Express Request cookies */
export async function getAuthUser(req: Request): Promise<JwtPayload | null> {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return null;
    return verifyToken(token);
  } catch {
    return null;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: EXPIRES_IN * 1000, // Express maxAge is in milliseconds
};
