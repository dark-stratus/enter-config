CURRENT STATE NOTE

The generated result files in this directory may contain measurements from the previous v3 run and must not be treated as current validation.

The previous Globalping recovery list was specifically invalidated after audit: the old implementation did not validate the returned probe city correctly and could accept datacenter probes as Russian recovery signals. The code has been fixed in v3.

Run .github/workflows/experimental-russia-checker-v3.yml again to regenerate all measurements with the corrected logic.
