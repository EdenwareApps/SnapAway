{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "icon_addon",
      "sources": [ "icon-addon-capi.c" ],
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
              "-lole32.lib",
              "-lshell32.lib",
              "-lwindowscodecs.lib"
            ]
          }
        ]
      ]
    }
  ]
}
