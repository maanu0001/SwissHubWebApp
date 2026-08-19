import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function toSkipTake(input: PaginationInput): { skip: number; take: number } {
  return { skip: (input.page - 1) * input.pageSize, take: input.pageSize };
}

export function paginate<T>(items: T[], total: number, input: PaginationInput): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages,
    hasNext: input.page < totalPages,
    hasPrevious: input.page > 1,
  };
}
