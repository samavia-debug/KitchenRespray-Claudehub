import type { TemplateInput } from "./templates";

// The company's letters of concern, written by its lawyers, as templates. Their wording is kept exactly as the lawyers wrote it, including
// their punctuation and spelling ("behavior"); only what changes from letter to letter is a fill-in box, [[like this]], or a {detail} taken
// from the staff record. The address block, "Date" and the signature lines of the originals are not here: the letterhead prints the
// address, the letter has its own date, and "Signed off by" puts the signer's name and title under the closing.
//
// Each one is an informal warning, so it is the "Warning or disciplinary letter" kind: it needs management approval before it is used.

const CONVERSATION = "Further to our conversation on [[Date of the conversation]] I am writing to inform you of my decision.";
const MATTER = "The matter of concern to me was:";
const REASON = "At the time, the reason you gave for your behavior was:\n\n[[The reason the employee gave]]";

const INFORMAL_WARNING = "On this particular occasion, we have decided not to proceed with formal disciplinary action. As a consequence, therefore you are now being issued with an informal warning.";
const INSTRUCTION = "Please understand from this letter that you are now in receipt of what we consider to be a reasonable written management instruction not to repeat these actions in the future.";
const NOT_FORMAL = "Although this is not a formal warning, should there be any repeat of this conduct, or indeed any misconduct in general you may be subject to formal disciplinary action. Please find enclosed a copy of the company's disciplinary rules and procedures in this regard.";
const QUERIES = "If you have any queries regarding the content of this letter, please do not hesitate to contact me.";

const letter = (topic: string, body: string[]): TemplateInput => ({
  name: `Letter of concern: ${topic}`,
  category: "hr",
  letter_type: "warning",
  subject: `Letter of concern: ${topic.toLowerCase()}`,
  greeting: "Dear {name},",
  body: body.join("\n\n"),
  closing: "Yours sincerely,",
});

export const CONCERN_LETTERS: TemplateInput[] = [
  letter("Lateness", [
    CONVERSATION,
    "The matter of concern to me was that you have been repeatedly late to start your shifts, which has led to customers not being contacted on time.",
    REASON,
    "Having listened to your explanation I consider it to be unsatisfactory because all employees are expected to start their shifts on their allocated time. This is to ensure operational efficiency and our customer's needs are met.",
    INFORMAL_WARNING,
    INSTRUCTION,
    NOT_FORMAL,
    QUERIES,
  ]),

  letter("Unfinished jobs", [
    CONVERSATION,
    MATTER,
    "- Leaving duties you are expected to carry out to a satisfactory standard unfinished without informing management the reasons for this.\n- Not applying best practice when carrying out your duties as requested by management.",
    REASON,
    INFORMAL_WARNING,
    INSTRUCTION,
    NOT_FORMAL,
    QUERIES,
  ]),

  // The driving letter opens differently and is punctuated slightly differently from the others; it is kept as written.
  letter("Dangerous driving", [
    "We have a matter of concern we would like to address with you, namely:",
    "- Dangerous driving in the company van",
    INFORMAL_WARNING.replace("As a consequence, therefore", "As a consequence therefore"),
    INSTRUCTION,
    NOT_FORMAL,
    QUERIES.replace("letter, please", "letter please"),
  ]),

  letter("Face mask", [
    CONVERSATION,
    MATTER,
    "- Failure to follow company policies and procedures, namely you failed to wear a face mask while carrying out spray painting as outlined in our employee handbook and as you are in close contact with dangerous chemicals.",
    INFORMAL_WARNING,
    INSTRUCTION,
    NOT_FORMAL,
    QUERIES,
  ]),

  letter("Before and after pictures", [
    CONVERSATION,
    MATTER,
    "- Failure to follow a reasonable management instruction, namely you failed to send before and after pictures as requested to do so by management.",
    INFORMAL_WARNING,
    INSTRUCTION,
    NOT_FORMAL,
    QUERIES,
  ]),
];
