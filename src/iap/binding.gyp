{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "iap_addon",
      "sources": ["iap-addon.cpp"],
      "include_dirs": [
        "<!(node -e \"const p=require('node-addon-api').include; process.stdout.write(p.charCodeAt(0)===34 ? p.slice(1,-1) : p)\")"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/Zc:__cplusplus", "/std:c++17", "/EHsc"]
              },
              "VCLinkerTool": {
                "DelayLoadDLLs": ["node.exe", "windowsapp.dll"],
                "AdditionalDependencies": ["delayimp.lib", "windowsapp.lib", "runtimeobject.lib"]
              }
            }
          }
        ]
      ]
    }
  ]
}
