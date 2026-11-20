/**
 * React Query hooks. Reads are cached and deduplicated. Writes invalidate the
 * cache, so the screen reloads from Sheets through the API after each change.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, callApi, newIdempotencyKey } from './api';

export interface Me {
  user: {
    user_id: string; username: string; display_name: string; org_id: string;
    email: string; must_change_password: boolean;
  };
  is_system_admin: boolean;
  grants: Record<string, string[]>;
  properties: Array<{
    property_id: string; code: string; name: string; status: string;
    business_date: string; currency: string; modules: string[];
  }>;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
}

export function hasGrant(me: Me | undefined, fn: string, level: string): boolean {
  if (!me) return false;
  const levels = me.grants[fn] ?? [];
  return levels.includes('Full Access') || levels.includes(level);
}

export function useApiQuery<T>(action: string, payload: Record<string, unknown>, enabled = true) {
  return useQuery<T, ApiError>({
    queryKey: [action, payload],
    queryFn: () => callApi<T>(action, payload),
    enabled,
    retry: false,
    staleTime: 15_000
  });
}

export function useApiAction<T = unknown>(action: string, onDone?: (data: T) => void) {
  const qc = useQueryClient();
  return useMutation<T, ApiError, Record<string, unknown>>({
    mutationFn: (payload) => callApi<T>(action, payload, newIdempotencyKey()),
    onSuccess: (data) => {
      qc.invalidateQueries();
      onDone?.(data);
    }
  });
}
