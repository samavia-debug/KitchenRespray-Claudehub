// The letter types, what each one needs, and what each one is allowed to send
// to the model. Kept in one place so the form, the checks and the prompt cannot
// drift apart. These are suggested categories, not the company's HR policy:
// sensitive ones are marked so management reviews them before use.

export const LETTER_STATUSES = ["draft", "finalised", "approved"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const STATUS_LABEL: Record<LetterStatus, string> = { draft: "Draft", finalised: "Finalised", approved: "Approved" };

export type FactKey = "jobTitle" | "role" | "department" | "team" | "branch" | "employmentType" | "startDate" | "employeeId" | "email" | "phone" | "address";

export const FACT_LABEL: Record<FactKey, string> = {
  jobTitle: "Job title",
  role: "Role",
  department: "Department",
  team: "Team",
  branch: "Branch",
  employmentType: "Employment type",
  startDate: "Start date",
  employeeId: "Employee ID",
  email: "Work email",
  phone: "Phone",
  address: "Home address",
};

export const LETTER_TYPE_KEYS = [
  "employment_confirmation",
  "employment_reference",
  "technician_introduction",
  "work_assignment",
  "experience_confirmation",
  "warning",
  "general_business",
  "custom",
] as const;
export type LetterTypeKey = (typeof LETTER_TYPE_KEYS)[number];

export type LetterTypeConfig = {
  key: LetterTypeKey;
  label: string;
  description: string;
  /** Needs management review and approval before it is used. */
  sensitive: boolean;
  /** Who the letter is addressed to. "technician" pre-fills the technician as the addressee. */
  recipient: "required" | "optional" | "technician";
  /** Facts the letter is expected to state; a warning is shown when one is missing. */
  requiredFacts: FactKey[];
  /** The only facts (besides the name) sent to the model for this type. */
  sendFacts: FactKey[];
  /** Offers a tick-box to include the technician's work email and phone. */
  allowContact: boolean;
  purposeLabel: string;
  purposePlaceholder: string;
  purposeRequired: boolean;
  showPeriod: boolean;
  periodLabel: string;
  showReference: boolean;
  /** Extra instruction for the model, specific to this type. */
  guidance: string;
};

export const LETTER_TYPES: LetterTypeConfig[] = [
  {
    key: "employment_confirmation",
    label: "Employment confirmation letter",
    description: "Confirms that the person works for the company, in what role and since when.",
    sensitive: false,
    recipient: "optional",
    requiredFacts: ["jobTitle", "startDate"],
    sendFacts: ["jobTitle", "employmentType", "department", "branch", "startDate", "employeeId"],
    allowContact: false,
    purposeLabel: "What is it needed for? (optional)",
    purposePlaceholder: "e.g. a mortgage application, or a landlord",
    purposeRequired: false,
    showPeriod: false,
    periodLabel: "",
    showReference: true,
    guidance:
      "Confirm only the employment facts supplied (name, job title, start date, employment type). Do not mention pay, salary, performance, conduct or future employment unless the user supplied it.",
  },
  {
    key: "employment_reference",
    label: "Employment reference letter",
    description: "A reference for a current or former technician. Needs management approval.",
    sensitive: true,
    recipient: "optional",
    requiredFacts: ["jobTitle", "startDate"],
    sendFacts: ["jobTitle", "employmentType", "department", "branch", "startDate"],
    allowContact: false,
    purposeLabel: "What should the reference say?",
    purposePlaceholder: "e.g. reliable, good with customers, spray finishing skills. Only include what you can stand behind.",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Period of employment (if different from the start date)",
    showReference: true,
    guidance:
      "Write a factual reference. State only the employment facts supplied and the qualities the user listed, in the user's own terms. Do not add praise, ratings, comparisons, reasons for leaving, or any claim about performance, conduct, attendance or rehire that the user did not supply.",
  },
  {
    key: "technician_introduction",
    label: "Technician introduction letter",
    description: "Introduces a technician to a customer or organisation before a visit.",
    sensitive: false,
    recipient: "required",
    requiredFacts: ["jobTitle"],
    sendFacts: ["jobTitle", "branch"],
    allowContact: true,
    purposeLabel: "Reason for the introduction",
    purposePlaceholder: "e.g. will visit on Tuesday to measure the kitchen",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Visit date or period",
    showReference: true,
    guidance:
      "Introduce the technician and say why they are being introduced, using only the supplied details. Do not promise outcomes, prices or timescales that were not supplied.",
  },
  {
    key: "work_assignment",
    label: "Work assignment letter",
    description: "Tells a technician which job or site they are assigned to.",
    sensitive: false,
    recipient: "technician",
    requiredFacts: ["jobTitle"],
    sendFacts: ["jobTitle", "branch", "team"],
    allowContact: false,
    purposeLabel: "Work being assigned",
    purposePlaceholder: "e.g. the Murphy kitchen in Bray, spraying the doors and drawer fronts",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Dates of the work",
    showReference: true,
    guidance:
      "Set out the assignment using only the supplied details. Do not add instructions, hours, pay, targets or conditions that were not supplied.",
  },
  {
    key: "experience_confirmation",
    label: "Experience confirmation letter",
    description: "Confirms the experience a technician has gained with the company.",
    sensitive: false,
    recipient: "optional",
    requiredFacts: ["jobTitle", "startDate"],
    sendFacts: ["jobTitle", "department", "branch", "startDate"],
    allowContact: false,
    purposeLabel: "Experience to confirm",
    purposePlaceholder: "e.g. kitchen respraying and worktop finishing",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Period of experience (if different from the start date)",
    showReference: true,
    guidance:
      "Confirm only the experience the user listed and the employment facts supplied. Do not add qualifications, certifications, years of experience or skill levels that were not supplied.",
  },
  {
    key: "warning",
    label: "Warning or disciplinary letter",
    description: "A formal warning. Needs management approval, and often HR or legal advice, before it is used.",
    sensitive: true,
    recipient: "technician",
    requiredFacts: ["jobTitle"],
    sendFacts: ["jobTitle", "employeeId"],
    allowContact: false,
    purposeLabel: "The matter, in facts only",
    purposePlaceholder: "e.g. late arrival on 3, 4 and 7 October, clock-in times attached. Do not include opinions.",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Date(s) of the matter",
    showReference: true,
    guidance:
      "Write a neutral, factual letter. State only the matter and dates supplied. Do not add allegations, motives, evidence, previous warnings, consequences, appeal rights, procedures or legal wording unless the user supplied them; if the user did not state the outcome or next steps, leave a [CONFIRM: ...] placeholder.",
  },
  {
    key: "general_business",
    label: "General business letter",
    description: "A plain business letter to a customer, supplier or organisation.",
    sensitive: false,
    recipient: "required",
    requiredFacts: [],
    sendFacts: ["jobTitle"],
    allowContact: false,
    purposeLabel: "What is the letter about?",
    purposePlaceholder: "Describe what you want the letter to say",
    purposeRequired: true,
    showPeriod: false,
    periodLabel: "",
    showReference: true,
    guidance: "Write the letter the user describes, using only the facts supplied. Mention the technician only if relevant to the purpose.",
  },
  {
    key: "custom",
    label: "Custom letter",
    description: "Describe any letter you need in your own words.",
    sensitive: false,
    recipient: "optional",
    requiredFacts: [],
    sendFacts: ["jobTitle", "department"],
    allowContact: false,
    purposeLabel: "Describe the letter you want",
    purposePlaceholder: "Who it is for, what it should say, and anything it must include",
    purposeRequired: true,
    showPeriod: true,
    periodLabel: "Relevant dates",
    showReference: true,
    guidance: "Write the letter the user describes, using only the facts supplied. Do not add facts, commitments or legal wording.",
  },
];

export const LETTER_TYPE_BY_KEY: Record<string, LetterTypeConfig> = Object.fromEntries(LETTER_TYPES.map((t) => [t.key, t]));

export const SENSITIVE_NOTICE =
  "This kind of letter can affect someone's employment. Management should review and approve it before it is sent, and for a warning or disciplinary letter you may want HR or legal advice first. Eleven can only draft it; it cannot decide what is fair.";
