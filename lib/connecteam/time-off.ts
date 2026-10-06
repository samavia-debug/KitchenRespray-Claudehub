import type { TimeOffRequest } from "./client";

export type TimeOffRow = {
  request_id: string;
  user_id: number;
  policy_type_id: string | null;
  leave_type: string;
  status: string;
  is_all_day: boolean;
  duration_days: number | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
};

/**
 * One row per request. The employee's free-text note is deliberately not
 * kept: on sick leave it can contain health details, which the dashboard has
 * no need to hold.
 */
export function parseTimeOffRequest(r: TimeOffRequest, typeNames: Map<string, string>): TimeOffRow {
  return {
    request_id: r.id,
    user_id: r.userId,
    policy_type_id: r.policyTypeId ?? null,
    leave_type: typeNames.get(r.policyTypeId)?.trim() || "Other leave",
    status: r.status,
    is_all_day: !!r.isAllDay,
    duration_days: r.duration?.units === "days" && typeof r.duration.amount === "number" ? r.duration.amount : null,
    start_date: r.startDate,
    end_date: r.endDate,
    start_time: r.startTime ?? null,
    end_time: r.endTime ?? null,
  };
}
