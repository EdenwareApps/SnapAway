{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "audio_addon",
      "sources": [ "audio-addon.cpp" ],
      "include_dirs": [ "<!@(node -p \"require('node-addon-api').include\")" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCLinkerTool": {
                "DelayLoadDLLs": ["node.exe"],
                "AdditionalDependencies": ["delayimp.lib"]
              }
            }
          }
        ]
      ]
    }
  ]
} 