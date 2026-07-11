import { latexToPretext } from "../src";
import { formatPretext } from "../../format/src";

const latexInput = document.getElementById(
  "latex-input",
) as HTMLTextAreaElement;
const pretextOutput = document.getElementById(
  "pretext-output",
) as HTMLTextAreaElement;
const status = document.getElementById("status") as HTMLElement;

const starterLatex = String.raw`\begin{problem}
Find the derivative of $x^3$.
\end{problem}

\begin{solution}
The derivative is $3x^2$.
\end{solution}`;

latexInput.value = starterLatex;

function convertLatex() {
  try {
    const result = latexToPretext(latexInput.value);
    const rawPretext = String(result.value ?? "");
    pretextOutput.value = formatPretext(rawPretext);
    status.textContent = "Converted successfully";
    status.classList.remove("error");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pretextOutput.value = "";
    status.textContent = `Conversion error: ${message}`;
    status.classList.add("error");
  }
}

latexInput.addEventListener("input", convertLatex);
convertLatex();
