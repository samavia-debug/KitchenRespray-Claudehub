import type { ConnecteamForm, FormAnswer, FormQuestion, FormSubmission } from "./client";

// "Tools & PPE Order Request" in Connecteam.
export const PPE_FORM_ID = 14538768;

export type PpeRow = {
  submission_id: string;
  form_id: number;
  submitted_at: string;
  submitter_user_id: number | null;
  items: string[];
  quantity: number | null;
  spray_suit_sizes: string[];
  other_text: string | null;
  date_required: string | null;
  status: string | null;
  status_updated_at: string | null;
  manager_note: string | null;
};

function findQuestion(form: ConnecteamForm, title: RegExp): FormQuestion | undefined {
  return form.questions.find((q) => title.test(q.title.replace(/<[^>]+>/g, "")));
}

function answerFor(submission: FormSubmission, question: FormQuestion | undefined): FormAnswer | undefined {
  return question ? submission.answers.find((a) => a.questionId === question.questionId) : undefined;
}

const choices = (a: FormAnswer | undefined): string[] => (a?.selectedAnswers ?? []).map((o) => o.text.trim()).filter(Boolean);

/**
 * One row per request. The manager (not the requester) sets the status and
 * writes the note in Connecteam, so "no status" means nobody has dealt with
 * the request yet.
 */
export function parsePpeRequest(form: ConnecteamForm, submission: FormSubmission): PpeRow {
  const quantityAnswer = answerFor(submission, findQuestion(form, /quantity/i));
  const otherAnswer = answerFor(submission, findQuestion(form, /other please/i));
  const dateAnswer = answerFor(submission, findQuestion(form, /date required/i));
  const statusField = submission.managerFields?.find((m) => m.managerFieldType === "status");
  const noteField = submission.managerFields?.find((m) => m.managerFieldType === "note");

  const quantity = quantityAnswer?.inputValue;

  return {
    submission_id: submission.formSubmissionId,
    form_id: submission.formId,
    submitted_at: new Date(submission.submissionTimestamp * 1000).toISOString(),
    submitter_user_id: submission.submittingUserId ?? null,
    items: choices(answerFor(submission, findQuestion(form, /requested tools/i))),
    quantity: typeof quantity === "number" && Number.isFinite(quantity) ? Math.round(quantity) : null,
    spray_suit_sizes: choices(answerFor(submission, findQuestion(form, /spray suit size/i))),
    other_text: typeof otherAnswer?.value === "string" && otherAnswer.value.trim() ? otherAnswer.value.trim() : null,
    date_required: dateAnswer?.timestamp ? new Date(dateAnswer.timestamp * 1000).toISOString() : null,
    status: statusField?.status?.name?.trim() || null,
    status_updated_at: statusField?.lastUpdatedTimestamp ? new Date(statusField.lastUpdatedTimestamp * 1000).toISOString() : null,
    manager_note: noteField?.note?.trim() || null,
  };
}
