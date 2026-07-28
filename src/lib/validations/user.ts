import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
  role: z.enum(["ADMIN", "FARM_USER"]),
});

export const userUpdateSchema = z.object({
  userId: z.string(),
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["ADMIN", "FARM_USER"]).optional(),
  isActive: z.boolean().optional(),
});

export const onboardingSchema = z.object({
  code: z.string().trim().min(1, "Invite code is required"),
  farmName: z.string().trim().min(1, "Farm name is required").max(120),
  adminName: z.string().trim().min(1, "Your name is required").max(80),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

export const settingsUpdateSchema = z.object({
  marketMinWeightKg: z.coerce.number().positive().max(2000),
  marketMinAgeDays: z.coerce.number().int().positive().max(3650),
  breedingMinAgeDaysFemale: z.coerce.number().int().positive().max(3650),
  breedingMinWeightKgFemale: z.coerce.number().positive().max(2000),
  pigletMaxAgeDays: z.coerce.number().int().positive().max(365),
  staleWeightDays: z.coerce.number().int().positive().max(365),
  overdueGraceDays: z.coerce.number().int().min(0).max(30),
});
