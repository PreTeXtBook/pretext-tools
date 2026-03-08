
import { useState } from "react";
import "./App.css";
import "./styles.scss";
import VisualEditor from "./components/VisualEditor";

/**
 * Simple demo app for the visual editor.
 * This is used for development and testing purposes only.
 * For VS Code integration, see the vscode-extension package.
 */
function App() {
  const [content, setContent] = useState(`<?xml version="1.0" encoding="UTF-8"?>
<pretext>
  <article>
    <title>Demo Document</title>
    <p>This is a simple demo of the PreTeXt visual editor.</p>
  </article>
</pretext>`);

  const handleChange = (ptx: string) => {
    setContent(ptx);
    console.log("Content changed:", ptx);
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
