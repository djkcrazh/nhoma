import { z } from "zod";

export const sexSchema = z.enum(["MALE", "FEMALE"]);

export const pigStatusSchema = z.enum([
  "PIGLET",
  "HEALTHY",
  "READY_FOR_CROSSING",
  "PREGNANT",
  "READY_TO_FARROW",
  "READY_FOR_MARKET",
  "SOLD",
  "INACTIVE",
  "DEAD",
]);

const dateNotFuture = z.coerce.date().refine((d) => d.getTime() <= Date.now() + 60_000, {
  message: "Date cannot be in the future",
});

export const pigCreateSchema = z
  .object({
    tagId: z
      .string()
      .trim()
      .min(1, "Tag ID is required")
      .max(32)
      .regex(/^[A-Za-z0-9-_]+$/, "Letters, numbers, dashes only"),
    breed: z.string().trim().min(1, "Breed is required").max(64),
    sex: sexSchema,
    dateOfBirth: dateNotFuture,
    motherId: z.string().optional().nullable(),
    fatherId: z.string().optional().nullable(),
    weightKg: z.coerce.number().positive("Weight must be positive").max(2000).optional().nullable(),
    castrated: z.boolean().optional().nullable(),
    breedingStock: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sex === "FEMALE" && v.castrated) {
      ctx.addIssue({ code: "custom", path: ["castrated"], message: "Female pigs cannot be castrated" });
    }
  });

export const pigUpdateSchema = z
  .object({
    tagId: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9-_]+$/).optional(),
    breed: z.string().trim().min(1).max(64).optional(),
    sex: sexSchema.optional(),
    dateOfBirth: dateNotFuture.optional(),
    motherId: z.string().nullable().optional(),
    fatherId: z.string().nullable().optional(),
    castrated: z.boolean().nullable().optional(),
    readyForCrossing: z.boolean().optional(),
    breedingStock: z.boolean().optional(),
    status: z.enum(["INACTIVE", "HEALTHY"]).optional(), // only manual statuses settable directly
  })
  .strict();

export const markSoldSchema = z.object({
  pigId: z.string(),
  soldAt: dateNotFuture.default(() => new Date()),
});

export const markDeadSchema = z.object({
  pigId: z.string(),
  diedAt: dateNotFuture.default(() => new Date()),
});

export type PigCreateInput = z.infer<typeof pigCreateSchema>;
export type PigUpdateInput = z.infer<typeof pigUpdateSchema>;

export const weightCreateSchema = z.object({
  pigId: z.string(),
  weightKg: z.coerce.number().positive("Weight must be positive").max(2000),
  measuredAt: dateNotFuture.default(() => new Date()),
});

export const breedingCreateSchema = z.object({
  sowId: z.string().min(1, "Sow is required"),
  boarId: z.string().optional().nullable(),
  crossingDate: dateNotFuture,
});

export const farrowSchema = z.object({
  breedingId: z.string(),
  farrowedAt: dateNotFuture,
  bornAlive: z.coerce.number().int().min(0).max(30),
  stillborn: z.coerce.number().int().min(0).max(30).default(0),
});

export const breedingCloseSchema = z.object({
  breedingId: z.string(),
  status: z.enum(["FAILED", "ABORTED"]),
});

export const noteCreateSchema = z.object({
  pigId: z.string(),
  body: z.string().trim().min(1, "Note cannot be empty").max(2000),
});
