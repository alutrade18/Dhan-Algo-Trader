export function checkForDH911(data: unknown) {
  if (data && typeof data === "object" && (data as Record<string, unknown>).errorCode === "DH-911") {
    window.dispatchEvent(new CustomEvent("dhan:staticip-error"));
  }
}
