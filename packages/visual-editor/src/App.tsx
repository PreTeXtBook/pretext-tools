
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import "./styles.scss";
import VisualEditor from "./components/VisualEditor";

type VscodeApi = {
  postMessage: (message: unknown) => void;
};

declare const acquireVsCodeApi: undefined | (() => VscodeApi);

function App() {
  const vscode = useMemo(() => {
    if (typeof acquireVsCodeApi === "function") {
      return acquireVsCodeApi();
    }
    return undefined;
  }, []);

  const [content, setContent] = useState("");

  useEffect(() => {
    if (!vscode) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; text?: string };
      if (message.type === "update" || message.type === "load") {
        setContent(message.text ?? "");
      }
    };

    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [vscode]);

  const handleChange = (ptx: string) => {
    setContent(ptx);
    vscode?.postMessage({ type: "update", value: ptx });
  };

  return (
    <div className="ptx-page">
      <main className="ptx-main">
        <div className="ptx-content">
          <VisualEditor content={content} onChange={handleChange} />
        </div>
      </main>
    </div>
  );
}

export default App;
