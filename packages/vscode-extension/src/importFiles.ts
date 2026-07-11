import { execSync, spawn } from "child_process";
import { homedir } from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import * as https from "https";
import timestamp from "time-stamp";

const pretextWriter = path.join(homedir(), ".ptx", "pandoc", "pretext.lua");

export function convertToPretext(method: string = "pandoc") {
  if (method === "plastex") {
    vscode.window.showOpenDialog().then((uri) => {
      if (uri) {
        console.log(uri);
        const inputfile = uri[0].fsPath;
        runPlastex(inputfile);
        console.log("PlasTeX finished");
      }
    });
    return;
  } else {
    if (pandocInstalled()) {
      console.log("Pandoc found; Waiting for file selection");
      ensurePretextLua();
      vscode.window.showOpenDialog().then((uri) => {
        if (uri) {
          console.log(uri);
          const inputfile = uri[0].fsPath;
          runPandoc(inputfile);
          console.log("Pandoc finished");
        }
      });
    } else {
      console.log("Pandoc not found");
      vscode.window.showErrorMessage(
        "Pandoc not found. Please install Pandoc and try again.",
        "Dismiss",
      );
    }
  }
}

function runPlastex(inputfile: string) {
  console.log("Converting to pretext using PlasTeX converter");
  // set outputDir to imports/timestamp
  const now = new Date();
  const outputDir = path.join(
    path.dirname(inputfile),
    "imports",
    path.basename(inputfile, ".tex"),
    timestamp(),
  );
  console.log("outputDir: " + outputDir);
  // run pretext import
  const importCommand = spawn(
    `pretext import -o "${outputDir}" "${inputfile}"`,
    { shell: true },
  );
}

function runPandoc(inputfile: string) {
  const output = inputfile.replace(path.extname(inputfile), ".ptx");
  console.log("output file: " + output);
  const pandoc = spawn(
    `pandoc "${inputfile}" -t "${pretextWriter}" -o "${output}"`,
    { shell: true },
  );
  pandoc.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });
  pandoc.stderr.on("data", (data) => {
    console.log(`stderr: ${data}`);
  });
  pandoc.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
    if (code === 0) {
      vscode.window.showInformationMessage(
        "PreTeXt file generated successfully",
      );
      vscode.window.showTextDocument(vscode.Uri.file(output));
    } else {
      vscode.window.showErrorMessage(
        "Conversion to PreTeXt failed. Please check the console for more information.",
        "Dismiss",
      );
    }
  });
}

function pandocInstalled() {
  console.log("Checking for Pandoc");
  let regex = /pandoc\s(2\.|3\.)/;
  return regex.test(execSync("pandoc --version").toString());
}

function ensurePretextLua() {
  const pretextLuaFile = path.join(homedir(), ".ptx", "pandoc", "pretext.lua");
  if (!fs.existsSync(pretextLuaFile)) {
    console.log("pretext.lua not found.  Installing...");
    if (!fs.existsSync(path.join(homedir(), ".ptx", "pandoc"))) {
      fs.mkdirSync(path.join(homedir(), ".ptx", "pandoc"), {
        recursive: true,
      });
    }
    const file = fs.createWriteStream(pretextLuaFile);
    const request = https.get(
      "https://raw.githubusercontent.com/oscarlevin/pandoc-pretext/master/pretext.lua",
      function (response) {
        response.pipe(file);

        // after download completed close filestream
        file.on("finish", () => {
          file.close();
          console.log("Download Completed");
        });
      },
    );
  } else {
    console.log("pretext.lua found at " + pretextLuaFile);
  }
}
