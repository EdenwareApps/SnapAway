{
  "variables": {
    "win_delay_load_hook": "true"
  },
  "targets": [
    {
      "target_name": "minimal_addon",
      "sources": ["minimal-addon.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='win'",
          {
            "msbuild_settings": {
              "ClCompile": {
                "AdditionalOptions": ["/std:c++17", "/Zm200", "/bigobj"]
              }
            },
            "msvs_settings": {
              "VCLinkerTool": {
                "DelayLoadDLLs": ["node.exe"],
                "AdditionalDependencies": ["delayimp.lib"]
              }
            }
          }
        ]
      ]
    },
    {
      "target_name": "minimal_c_addon",
      "sources": ["minimal-c-addon.c"],
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
    },
    {
      "target_name": "minimal_cpp_capi_addon",
      "sources": ["minimal-cpp-capi-addon.cpp"],
      "conditions": [
        [
          "OS=='win'",
          {
            "msbuild_settings": {
              "ClCompile": {
                "AdditionalOptions": ["/std:c++17", "/Zm200", "/bigobj"]
              }
            },
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
