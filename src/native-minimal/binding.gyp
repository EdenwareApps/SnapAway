{
  "targets": [
    {
      "target_name": "minimal_addon",
      "sources": [ "minimal-addon.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msbuild_settings": {
              "ClCompile": {
                "AdditionalOptions": ["/std:c++17", "/Zm200", "/bigobj"]
              }
            }
          }
        ]
      ]
    }
  ]
}
