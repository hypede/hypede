// Record frames from inside the shell: rec(dir, count) → timestamps file.
globalThis.__rec = async (dir, count) => {
    const {Gio, GLib, Shell} = imports.gi;
    GLib.mkdir_with_parents(dir, 0o755);
    const times = [];
    const t0 = GLib.get_monotonic_time();
    for (let i = 0; i < count && !globalThis.__recStop; i++) {
        const t = GLib.get_monotonic_time() - t0;
        const file = Gio.File.new_for_path(`${dir}/f${String(i).padStart(5, '0')}.png`);
        const stream = file.replace(null, false, 0, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
        times.push(t);
    }
    GLib.file_set_contents(`${dir}/times.json`, JSON.stringify(times));
    globalThis.__recDone = true;
};
1
