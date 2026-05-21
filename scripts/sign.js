"use strict"
const { execFileSync } = require("child_process")
const path = require("path")

exports.default = async function (context) {
  const exe = context.path
  return execFileSync("powershell.exe", ["-ExecutionPolicy","Bypass","-NoProfile",
    "-File", "J:\\PROJECTS\\signtool.ps1","-ExecutablePath", exe,
    "-Description", "SnapAway", "-DescriptionURL", "https://edenware.app/snapaway"
  ], { stdio: "inherit" })
}