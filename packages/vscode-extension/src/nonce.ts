/**
 * Generate a random nonce for use in webview content security policy.
 *
 * Lives in its own module (rather than `utils.ts`) because webview providers
 * are part of the browser bundle (`extension.web.ts`) and `utils.ts` imports
 * `child_process`.
 * @returns A random nonce string.
 */
export function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
