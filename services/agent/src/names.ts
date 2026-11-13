/**
 * Words in a business name that say what kind of company it is, not which one: "(Pty) Ltd", "Inc" and
 * the like. agent.ts strips them from the end of a name before the supplier lookup retry; the chat
 * payee check ignores them wherever they appear. One list, so the two never drift apart.
 */
export const LEGAL_FORM_WORDS = ["pty", "ltd", "limited", "inc", "incorporated", "llc", "plc", "gmbh", "cc", "co"] as const;
