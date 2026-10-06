import type { ConnecteamForm, FormAnswer, FormQuestion, FormSubmission } from "./client";

// "Weekly Driver's Vehicle Inspection Report" in Connecteam.
export const VEHICLE_FORM_ID = 14538409;

export type InspectionRow = {
  submission_id: string;
  form_id: number;
  submitted_at: string;
  inspected_at: string | null;
  submitter_user_id: number | null;
  driver_name: string | null;
  vehicle_reg: string;
  vehicle_key: string;
  make_model: string | null;
  odometer_text: string | null;
  odometer_km: number | null;
  trip_type: string | null;
  defects: string[];
  safety_equipment_ok: boolean | null;
  condition_ok: boolean | null;
  remarks: string | null;
};

/** "191-D-12345", "191 d 12345" and "191D12345" are the same van. */
export function normalizeReg(reg: string): string {
  return reg.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The odometer is a free-text box: "123456", "123.456" (a thousands dot),
 * "-", "9". Digits only, then reject anything too small or too large to be
 * a real reading so a typo can't become "the latest odometer".
 */
export function parseOdometer(text: string | null | undefined): number | null {
  const digits = (text ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return n >= 100 && n <= 2_000_000 ? n : null;
}

function findQuestion(form: ConnecteamForm, title: RegExp): FormQuestion | undefined {
  return form.questions.find((q) => title.test(q.title));
}

function answerFor(submission: FormSubmission, question: FormQuestion | undefined): FormAnswer | undefined {
  return question ? submission.answers.find((a) => a.questionId === question.questionId) : undefined;
}

function textOf(submission: FormSubmission, question: FormQuestion | undefined): string {
  const a = answerFor(submission, question);
  return typeof a?.value === "string" ? a.value.trim() : "";
}

// Yes/No questions store the chosen option's index; its label ("Pre-Trip",
// "Yes") lives on the question definition.
function choiceTextOf(submission: FormSubmission, question: FormQuestion | undefined): string | null {
  const a = answerFor(submission, question);
  if (!question || a?.selectedIndex === undefined) return null;
  return question.allAnswers?.find((o) => o.yesNoOptionId === a.selectedIndex)?.text.trim() ?? null;
}

function yesNo(text: string | null): boolean | null {
  if (!text) return null;
  if (/^yes/i.test(text)) return true;
  if (/^no/i.test(text)) return false;
  return null;
}

/** Null when the submission has no registration, since it can't be tied to a vehicle. */
export function parseInspection(form: ConnecteamForm, submission: FormSubmission): InspectionRow | null {
  const reg = textOf(submission, findQuestion(form, /registration/i));
  const key = normalizeReg(reg);
  if (!key) return null;

  const dateAnswer = answerFor(submission, findQuestion(form, /date of inspection/i));
  const odometerText = textOf(submission, findQuestion(form, /odometer/i));
  const defectAnswer = answerFor(submission, findQuestion(form, /defective/i));

  return {
    submission_id: submission.formSubmissionId,
    form_id: submission.formId,
    submitted_at: new Date(submission.submissionTimestamp * 1000).toISOString(),
    inspected_at: dateAnswer?.timestamp ? new Date(dateAnswer.timestamp * 1000).toISOString() : null,
    submitter_user_id: submission.submittingUserId ?? null,
    driver_name: textOf(submission, findQuestion(form, /full name/i)) || null,
    vehicle_reg: reg,
    vehicle_key: key,
    make_model: textOf(submission, findQuestion(form, /make and model/i)) || null,
    odometer_text: odometerText || null,
    odometer_km: parseOdometer(odometerText),
    trip_type: choiceTextOf(submission, findQuestion(form, /pre-trip/i)),
    // The form's "tick any defective item" list includes a "nothing wrong" option.
    defects: (defectAnswer?.selectedAnswers ?? [])
      .map((d) => d.text.trim())
      .filter((d) => d && !/everything working well/i.test(d)),
    safety_equipment_ok: yesNo(choiceTextOf(submission, findQuestion(form, /safety equipment/i))),
    condition_ok: yesNo(choiceTextOf(submission, findQuestion(form, /condition/i))),
    remarks: textOf(submission, findQuestion(form, /remarks/i)) || null,
  };
}

export function parseInspections(
  form: ConnecteamForm,
  submissions: FormSubmission[]
): { rows: InspectionRow[]; skipped: number } {
  const rows: InspectionRow[] = [];
  let skipped = 0;
  for (const s of submissions) {
    const row = parseInspection(form, s);
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}
