# GitWorld application identity

The original mark combines a blue globe with three connected version nodes on a graphite tile. The globe represents the shared historical setting; the fork represents continuity and divergence. The source artwork is licensed under the repository's Apache-2.0 license.

- `icon.svg` is the editable 1024 px master.
- `icon-small.svg` is an optical variant for 16 and 32 point sizes, including Retina output. It reduces background detail and adjusts line weights.

Run `npm run desktop:icon` to generate PNG variants and a macOS ICNS in the ignored `.local/desktop-icon` directory. The build uses the pinned SVG renderer and no installed fonts or external artwork. Generated files are build artifacts; edit the SVG sources.

The desktop build includes a PNG for the development Dock and window icon. macOS packages also set `CFBundleIconFile` to the generated ICNS. Verify both source runs and the packaged app when changing this wiring: a correct Finder icon does not prove that the development Electron Dock uses the same artwork.
