const BASE_URL = "https://api.connecteam.com";
const PAGE_SIZE = 500;
const MAX_PAGES = 40;

export type ConnecteamCustomField = {
  customFieldId: number;
  name: string;
  type: string;
  value: unknown;
};

export type ConnecteamUser = {
  userId: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  userType?: string;
  isArchived?: boolean;
  customFields?: ConnecteamCustomField[];
};

export type FormQuestion = {
  questionId: string;
  title: string;
  questionType: string;
  allAnswers?: { yesNoOptionId?: number; multipleChoiceOptionId?: string; text: string }[];
};

export type ConnecteamForm = { formId: number; formName: string; questions: FormQuestion[] };

export type FormAnswer = {
  questionId: string;
  questionType: string;
  value?: string;
  selectedIndex?: number;
  selectedAnswers?: { text: string }[];
  timestamp?: number;
  inputValue?: number;
};

export type ManagerField = {
  managerFieldId: string;
  managerFieldType: string;
  note?: string;
  status?: { name: string };
  lastUpdatedTimestamp?: number;
};

export type FormSubmission = {
  formSubmissionId: string;
  formId: number;
  submissionTimestamp: number;
  submittingUserId?: number;
  answers: FormAnswer[];
  managerFields?: ManagerField[];
};

export function isConnecteamConfigured(): boolean {
  return !!process.env.CONNECTEAM_API_KEY;
}

async function connecteamGet<T>(path: string): Promise<T> {
  const key = process.env.CONNECTEAM_API_KEY;
  if (!key) throw new Error("CONNECTEAM_API_KEY is not set");

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-API-KEY": key, Accept: "application/json" },
  });

  if (!res.ok) {
    // Status only — never echo the request headers, which carry the key.
    throw new Error(`Connecteam API returned HTTP ${res.status}${res.status === 403 ? " (key rejected or expired)" : ""}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Every Connecteam user, current and archived. The API's userStatus filter
 * accepts "active", "archived" or "all" (its own docs say "inactive", which
 * the live API rejects with a 400) — "all" returns both in one list, and each
 * record carries its own isArchived flag.
 */
export async function fetchAllConnecteamUsers(): Promise<ConnecteamUser[]> {
  const all: ConnecteamUser[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await connecteamGet<{ data?: { users?: ConnecteamUser[] } }>(
      `/users/v1/users?limit=${PAGE_SIZE}&offset=${offset}&userStatus=all`
    );
    const users = body.data?.users ?? [];
    all.push(...users);
    if (users.length < PAGE_SIZE) break;
    offset += users.length;
  }

  return all;
}

export async function fetchConnecteamForm(formId: number): Promise<ConnecteamForm | null> {
  const body = await connecteamGet<{ data?: { forms?: ConnecteamForm[] } }>("/forms/v1/forms");
  return body.data?.forms?.find((f) => f.formId === formId) ?? null;
}

/** Every submission of one form, oldest and newest alike, 100 per page. */
export async function fetchFormSubmissions(formId: number): Promise<FormSubmission[]> {
  const pageSize = 100;
  const all: FormSubmission[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await connecteamGet<{ data?: { formSubmissions?: FormSubmission[] } }>(
      `/forms/v1/forms/${formId}/form-submissions?limit=${pageSize}&offset=${offset}`
    );
    const batch = body.data?.formSubmissions ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return all;
}

export type ShiftSide = { timestamp?: number | null; timezone?: string; source?: { type?: string } };

export type TimeClockShift = {
  id: string;
  start: ShiftSide;
  end?: ShiftSide | null;
  jobId?: string;
  schedulerShiftId?: string;
  isAutoClockOut?: boolean;
};

export type TimeActivityUser = { userId: number; shifts: TimeClockShift[] };
export type ConnecteamTimeClock = { id: number; name: string; isArchived?: boolean };
export type ConnecteamJob = { jobId: string; title: string; isDeleted?: boolean };
export type TimeOffPolicyType = { id: string; name: string };

export type TimeOffRequest = {
  id: string;
  userId: number;
  policyTypeId: string;
  isAllDay: boolean;
  duration?: { units: string; amount: number };
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  status: string;
};

export async function fetchTimeClocks(): Promise<ConnecteamTimeClock[]> {
  const body = await connecteamGet<{ data?: { timeClocks?: ConnecteamTimeClock[] } }>("/time-clock/v1/time-clocks");
  return body.data?.timeClocks ?? [];
}

/** Clock-ins between two YYYY-MM-DD dates. The API rejects windows much over 90 days. */
export async function fetchTimeActivities(clockId: number, startDate: string, endDate: string): Promise<TimeActivityUser[]> {
  const body = await connecteamGet<{ data?: { timeActivitiesByUsers?: TimeActivityUser[] } }>(
    `/time-clock/v1/time-clocks/${clockId}/time-activities?startDate=${startDate}&endDate=${endDate}`
  );
  return body.data?.timeActivitiesByUsers ?? [];
}

export async function fetchJobs(): Promise<ConnecteamJob[]> {
  const body = await connecteamGet<{ data?: { jobs?: ConnecteamJob[] } }>("/jobs/v1/jobs?limit=500");
  return body.data?.jobs ?? [];
}

export async function fetchTimeOffPolicyTypes(): Promise<TimeOffPolicyType[]> {
  const body = await connecteamGet<{ data?: { policyTypes?: TimeOffPolicyType[] } }>("/time-off/v1/policy-types");
  return body.data?.policyTypes ?? [];
}

/** Time off between two YYYY-MM-DD dates (365 days at most), 100 per page. */
export async function fetchTimeOffRequests(startDate: string, endDate: string): Promise<TimeOffRequest[]> {
  const pageSize = 100;
  const all: TimeOffRequest[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await connecteamGet<{ data?: { timeOffRequests?: TimeOffRequest[]; requests?: TimeOffRequest[] } }>(
      `/time-off/v1/requests?startDate=${startDate}&endDate=${endDate}&limit=${pageSize}&offset=${offset}`
    );
    const data = body.data as Record<string, unknown> | undefined;
    const batch = ((data && Object.values(data).find(Array.isArray)) as TimeOffRequest[] | undefined) ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return all;
}
