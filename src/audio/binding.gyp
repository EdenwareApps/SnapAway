{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "audio_addon",
      "sources": [ "audio-addon-capi.c" ],
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