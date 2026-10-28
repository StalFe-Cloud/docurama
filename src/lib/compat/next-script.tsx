/**
 * Compatibility shim: next/script. Third-party loader scripts (Turnstile)
 * are inert in the demo build; render nothing.
 */
export default function Script(_props: Record<string, unknown>) {
  return null;
}
