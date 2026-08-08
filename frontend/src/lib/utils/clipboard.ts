export async function copyToClipboard(text: string): Promise<boolean> {
    // 1. Try modern Clipboard API (Secure Contexts only)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.warn("Clipboard API failed, falling back:", err);
        }
    }

    // 2. Fallback for insecure contexts (HTTP over non-localhost)
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // Hide the textarea completely off-screen
        textArea.style.position = "fixed";
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.width = "0";
        textArea.style.height = "0";
        textArea.style.padding = "0";
        textArea.style.border = "none";
        textArea.style.outline = "none";
        textArea.style.boxShadow = "none";
        textArea.style.background = "transparent";
        textArea.style.opacity = "0";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand("copy");
        document.body.removeChild(textArea);

        if (!successful) {
            throw new Error("execCommand('copy') returned false");
        }
        return true;
    } catch (err) {
        console.error("Fallback copy method failed:", err);
        return false;
    }
}
