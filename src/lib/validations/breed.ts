import { z } from "zod";

export const breedNameSchema = z.string().trim().min(1, "Breed name is required").max(64);

export const breedCreateSchema = z.object({
  name: breedNameSchema,
});

export const breedRenameSchema = z.object({
  id: z.string(),
  name: breedNameSchema,
});
