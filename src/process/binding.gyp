{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "process_addon",
      "sources": [ "process-addon-capi.c" ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCLinkerTool": {
                "DelayLoadDLLs": ["node.exe"],
                "AdditionalDependencies": ["delayimp.lib"]
              }
            },
            "libraries": [
              "-luser32.lib",
              "-lkernel32.lib",
              "-lpsapi.lib"
            ]
          }
        ]
      ]
    }
  ]
}
