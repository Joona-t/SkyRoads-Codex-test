use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

use skyroads_core::{GameplaySession, ShipState};
use skyroads_data::{
    level_from_road_entry, levels_from_roads_archive, load_demo_rec_path, load_image_archive_path,
    load_muzax_lzs_path, load_roads_lzs_path, load_skyroads_exe_path, load_trekdat_lzs_path, Error,
    Level, LevelCell, Result, TouchEffect, GROUND_Y, LEVEL_CENTER_X, LEVEL_MAX_X, LEVEL_MIN_X,
    LEVEL_TILE_STRIDE_X,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let mut args = env::args();
    let program = args.next().unwrap_or_else(|| "skyroads-cli".to_string());
    let command = args.next();
    let source_root = args.next();
    let extra = args.collect::<Vec<_>>();

    match (command.as_deref(), source_root) {
        (Some("summary"), Some(source_root)) => summary(Path::new(&source_root)),
        (Some("demo-sim"), Some(source_root)) => demo_sim(Path::new(&source_root), &extra),
        (Some("export-json"), Some(source_root)) => export_json(Path::new(&source_root), &extra),
        _ => {
            eprintln!("usage: {program} <summary|demo-sim|export-json> <source_root> [out_dir]");
            eprintln!("  export-json  decode all roads + world palettes to JSON for the web/ neon game");
            eprintln!("               (out_dir default: web/assets)");
            process::exit(2);
        }
    }
}

fn summary(source_root: &Path) -> Result<()> {
    let roads = load_roads_lzs_path(source_root.join("ROADS.LZS"))?;
    let demo = load_demo_rec_path(source_root.join("DEMO.REC"))?;
    let trekdat = load_trekdat_lzs_path(source_root.join("TREKDAT.LZS"))?;
    let muzax = load_muzax_lzs_path(source_root.join("MUZAX.LZS"))?;
    let exe = load_skyroads_exe_path(source_root.join("SKYROADS.EXE"))?;

    println!("SkyRoads Native Baseline");
    println!("source_root: {}", normalize_path(source_root));
    println!();

    println!("roads:");
    println!("  road_count: {}", roads.road_count());
    println!(
        "  used_dispatch_kinds: {}",
        join_u8s(roads.used_dispatch_kinds())
    );
    println!(
        "  distinct_descriptor_count: {}",
        roads.distinct_descriptor_count()
    );
    for entry in &roads.descriptor_catalog.dispatch_kinds {
        println!(
            "  dispatch_kind_{}: count={} descriptors={}",
            entry.dispatch_kind, entry.count, entry.descriptor_count
        );
    }
    println!();

    println!("demo:");
    println!("  byte_count: {}", demo.byte_count());
    println!(
        "  approx_tile_length_fp16: 0x{:08X}",
        demo.approx_tile_length_fp16()
    );
    println!("  approx_tile_length: {:.9}", demo.approx_tile_length());
    println!(
        "  accelerate_decelerate_counts: {}",
        join_i8_counts(&demo.accelerate_decelerate_counts)
    );
    println!(
        "  left_right_counts: {}",
        join_i8_counts(&demo.left_right_counts)
    );
    println!(
        "  jump_counts: false={} true={}",
        demo.jump_counts.false_count, demo.jump_counts.true_count
    );
    println!();

    println!("trekdat:");
    println!("  record_count: {}", trekdat.record_count());
    println!("  pointer_grid: 13x24");
    let expanded_sizes = trekdat
        .records
        .iter()
        .map(|record| record.load_buff_end.to_string())
        .collect::<Vec<_>>()
        .join(",");
    println!("  expanded_sizes: {}", expanded_sizes);
    let span_counts = trekdat
        .records
        .iter()
        .map(|record| record.total_span_count().to_string())
        .collect::<Vec<_>>()
        .join(",");
    println!("  total_span_counts: {}", span_counts);
    let pointer_maxes = trekdat
        .records
        .iter()
        .map(|record| record.pointer_max().to_string())
        .collect::<Vec<_>>()
        .join(",");
    println!("  pointer_maxes: {}", pointer_maxes);
    println!();

    println!("muzax:");
    println!("  song_table_size: {}", muzax.song_table_size);
    println!("  song_count: {}", muzax.song_count());
    println!("  populated_song_count: {}", muzax.populated_song_count());
    if let Some(song0) = muzax.songs.first() {
        if let Some(widths) = song0.widths {
            println!("  song_0_widths: {},{},{}", widths[0], widths[1], widths[2]);
        }
        println!("  song_0_instrument_bytes: {}", song0.instrument_bytes);
        println!("  song_0_command_bytes: {}", song0.command_bytes);
        if let Some(summary) = &song0.command_summary {
            println!(
                "  song_0_function_counts: {}",
                summary
                    .function_counts
                    .iter()
                    .map(|value| value.to_string())
                    .collect::<Vec<_>>()
                    .join(",")
            );
        }
    }
    println!();

    println!("exe:");
    println!("  header_bytes: {}", exe.header_bytes);
    println!("  image_size: {}", exe.image_size);
    println!("  entry_file_offset: {}", exe.entry_file_offset);
    println!(
        "  exe_reader_base_file_offset: {}",
        exe.exe_reader_base_file_offset
    );
    println!(
        "  tile_class_by_low3: {}",
        exe.runtime_tables
            .tile_class_by_low3
            .values
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(",")
    );
    println!(
        "  draw_dispatch_by_type: {}",
        exe.runtime_tables
            .draw_dispatch_by_type
            .entries
            .iter()
            .map(|entry| format!("{:04X}", entry.target))
            .collect::<Vec<_>>()
            .join(",")
    );

    Ok(())
}

fn demo_sim(source_root: &Path, extra: &[String]) -> Result<()> {
    let frame_count = extra
        .first()
        .map(|value| {
            value.parse::<usize>().unwrap_or_else(|_| {
                eprintln!("invalid frame count: {value}");
                process::exit(2);
            })
        })
        .unwrap_or(60);

    let roads = load_roads_lzs_path(source_root.join("ROADS.LZS"))?;
    let demo = load_demo_rec_path(source_root.join("DEMO.REC"))?;
    let level = level_from_road_entry(&roads.roads[0]);
    let mut session = GameplaySession::new(level.clone());

    println!("SkyRoads Demo Simulation");
    println!("source_root: {}", normalize_path(source_root));
    println!("level: {} (index {})", level.name, level.road_index);
    println!(
        "gravity: {} fuel: {} oxygen: {}",
        level.gravity, level.fuel, level.oxygen
    );
    println!("frames: {}", frame_count);
    println!();

    for _ in 0..frame_count {
        let frame = session.run_demo_frame(&demo);
        println!(
            "frame={:04} turn={:+} accel={:+} jump={} row={} pos=({:.6},{:.6},{:.6}) zvel={:.6} oxygen={:.6} fuel={:.6} state={} events={}",
            frame.frame_index,
            frame.controls.turn_input,
            frame.controls.accel_input,
            if frame.controls.jump_input { 1 } else { 0 },
            frame.road_row_index,
            frame.snapshot.x_position,
            frame.snapshot.y_position,
            frame.snapshot.z_position,
            frame.snapshot.z_velocity,
            frame.snapshot.oxygen_percent,
            frame.snapshot.fuel_percent,
            ship_state_name(frame.snapshot.craft_state),
            join_events(&frame.events),
        );
    }

    Ok(())
}

fn normalize_path(path: &Path) -> String {
    std::fs::canonicalize(path)
        .unwrap_or_else(|_| {
            if path.is_absolute() {
                path.to_path_buf()
            } else {
                env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join(path)
            }
        })
        .display()
        .to_string()
}

fn join_u8s(values: &[u8]) -> String {
    values
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

fn join_i8_counts(counts: &std::collections::BTreeMap<i8, usize>) -> String {
    counts
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn ship_state_name(state: ShipState) -> &'static str {
    match state {
        ShipState::Alive => "Alive",
        ShipState::Exploded => "Exploded",
        ShipState::Fallen => "Fallen",
        ShipState::OutOfFuel => "OutOfFuel",
        ShipState::OutOfOxygen => "OutOfOxygen",
    }
}

fn join_events(events: &[skyroads_core::GameplayEvent]) -> String {
    if events.is_empty() {
        return "-".to_string();
    }

    events
        .iter()
        .map(|event| match event {
            skyroads_core::GameplayEvent::ShipBumpedWall => "ShipBumpedWall",
            skyroads_core::GameplayEvent::ShipExploded => "ShipExploded",
            skyroads_core::GameplayEvent::ShipBounced => "ShipBounced",
            skyroads_core::GameplayEvent::ShipRefilled => "ShipRefilled",
        })
        .collect::<Vec<_>>()
        .join(",")
}

// ================================================================================================
// export-json — asset-extraction pipeline for the web/ neon 3D game (MERGER-PLAN.md §3).
// Serializes the already-decoded Level grid + palettes to JSON. Serde lives only in this leaf
// binary so the library crates stay zero-dependency. Emits NOTHING that is committed to git:
// the default out_dir (web/assets) is .gitignored — see NOTICE for the IP rationale.
// ================================================================================================

/// WORLD*.LZS are visual/palette themes; roads map to them as `world = (i-1)/3` for i>=1.
fn world_index(road_index: usize) -> usize {
    if road_index == 0 {
        0
    } else {
        (road_index - 1) / 3
    }
}

fn effect_str(effect: TouchEffect) -> &'static str {
    match effect {
        TouchEffect::None => "none",
        TouchEffect::Accelerate => "accelerate",
        TouchEffect::Decelerate => "decelerate",
        TouchEffect::Kill => "kill",
        TouchEffect::Slide => "slide",
        TouchEffect::RefillOxygen => "refillOxygen",
    }
}

/// RoadEntry.palette_vga is RAW 6-bit VGA (0..63) — scale x4 (saturating) to 8-bit RGB888.
/// (World/CMAP palettes are ALREADY x4'd by the image parser — do NOT scale those again.)
fn vga6_to_rgb888(vga: &[u8]) -> Vec<[u8; 3]> {
    vga.chunks_exact(3)
        .map(|c| [c[0].saturating_mul(4), c[1].saturating_mul(4), c[2].saturating_mul(4)])
        .collect()
}

#[derive(serde::Serialize)]
struct CellExport {
    raw: u16,
    kind: u8, // geometry primitive: 0 flat,1 flat+tunnel,2 cube100,3 cube100+tunnel,4 cube120,5 cube120+tunnel
    tile: bool,
    tunnel: bool,
    cube: Option<u16>,
    #[serde(rename = "tileColor")]
    tile_color: u8,
    #[serde(rename = "cubeColor")]
    cube_color: u8,
    #[serde(rename = "tileEffect")]
    tile_effect: &'static str,
    #[serde(rename = "cubeEffect")]
    cube_effect: &'static str,
}

fn cell_export(c: &LevelCell) -> CellExport {
    let cube_bits = match c.cube_height {
        Some(100) => 2u8,
        Some(120) => 4u8,
        _ => 0u8,
    };
    CellExport {
        raw: c.raw_descriptor,
        kind: cube_bits + if c.has_tunnel { 1 } else { 0 },
        tile: c.has_tile,
        tunnel: c.has_tunnel,
        cube: c.cube_height,
        tile_color: c.color_index_low,
        cube_color: c.color_index_high,
        tile_effect: effect_str(c.tile_effect),
        cube_effect: effect_str(c.cube_effect),
    }
}

#[derive(serde::Serialize)]
struct StartExport {
    x: f64,
    y: f64,
    z: f64,
}

#[derive(serde::Serialize)]
struct ConstantsExport {
    #[serde(rename = "tileStrideX")]
    tile_stride_x: f64,
    #[serde(rename = "groundY")]
    ground_y: f64,
    #[serde(rename = "roadColumns")]
    road_columns: usize,
    #[serde(rename = "levelMinX")]
    level_min_x: f64,
    #[serde(rename = "levelMaxX")]
    level_max_x: f64,
    #[serde(rename = "levelCenterX")]
    level_center_x: f64,
    #[serde(rename = "cubeShortTop")]
    cube_short_top: u16,
    #[serde(rename = "cubeTallTop")]
    cube_tall_top: u16,
    #[serde(rename = "zPerRow")]
    z_per_row: f64,
}

#[derive(serde::Serialize)]
struct LevelExport {
    version: u32,
    #[serde(rename = "roadIndex")]
    road_index: usize,
    name: String,
    world: usize,
    gravity: u16,
    fuel: u16,
    oxygen: u16,
    columns: usize,
    length: usize,
    start: StartExport,
    constants: ConstantsExport,
    palette: Vec<[u8; 3]>,
    cells: Vec<Vec<CellExport>>,
}

fn build_level_export(level: &Level, world: usize, palette: Vec<[u8; 3]>) -> LevelExport {
    let cells = level
        .cells
        .iter()
        .map(|row| row.iter().map(cell_export).collect())
        .collect();
    LevelExport {
        version: 1,
        road_index: level.road_index,
        name: level.name.clone(),
        world,
        gravity: level.gravity,
        fuel: level.fuel,
        oxygen: level.oxygen,
        columns: level.width(),
        length: level.length(),
        start: StartExport {
            x: LEVEL_CENTER_X,
            y: GROUND_Y,
            z: 3.0,
        },
        constants: ConstantsExport {
            tile_stride_x: LEVEL_TILE_STRIDE_X,
            ground_y: GROUND_Y,
            road_columns: level.width(),
            level_min_x: LEVEL_MIN_X,
            level_max_x: LEVEL_MAX_X,
            level_center_x: LEVEL_CENTER_X,
            cube_short_top: 100,
            cube_tall_top: 120,
            z_per_row: 1.0,
        },
        palette,
        cells,
    }
}

#[derive(serde::Serialize)]
struct IndexEntry {
    file: String,
    world: usize,
    name: String,
    #[serde(rename = "roadIndex")]
    road_index: usize,
    length: usize,
}

#[derive(serde::Serialize)]
struct LevelIndex {
    version: u32,
    #[serde(rename = "generatedFrom")]
    generated_from: &'static str,
    count: usize,
    levels: Vec<IndexEntry>,
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json =
        serde_json::to_string_pretty(value).map_err(|e| Error::invalid_format(e.to_string()))?;
    fs::write(path, json)?;
    Ok(())
}

fn export_json(source_root: &Path, extra: &[String]) -> Result<()> {
    let out_dir = extra
        .first()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("web/assets"));

    let roads = load_roads_lzs_path(source_root.join("ROADS.LZS"))?;
    let levels = levels_from_roads_archive(&roads);

    let mut index = Vec::with_capacity(levels.len());
    for (level, road) in levels.iter().zip(roads.roads.iter()) {
        let world = world_index(level.road_index);
        let palette = vga6_to_rgb888(&road.palette_vga);
        let file = format!("level_{:02}.json", level.road_index);
        write_json(
            &out_dir.join("levels").join(&file),
            &build_level_export(level, world, palette),
        )?;
        index.push(IndexEntry {
            file,
            world,
            name: level.name.clone(),
            road_index: level.road_index,
            length: level.length(),
        });
    }
    let level_count = index.len();
    write_json(
        &out_dir.join("levels").join("index.json"),
        &LevelIndex {
            version: 1,
            generated_from: "ROADS.LZS",
            count: level_count,
            levels: index,
        },
    )?;

    // Per-world backdrop palettes (already x4'd by the CMAP parser — emit as-is).
    let mut world_palettes = 0usize;
    for i in 0..=9u32 {
        match load_image_archive_path(source_root.join(format!("WORLD{i}.LZS"))) {
            Ok(archive) => {
                if let Some(frame) = archive.frames.first().and_then(|f| f.first()) {
                    let pal: Vec<[u8; 3]> = frame
                        .palette
                        .colors
                        .iter()
                        .map(|c| [c.r, c.g, c.b])
                        .collect();
                    write_json(&out_dir.join("palettes").join(format!("world_{i}.json")), &pal)?;
                    world_palettes += 1;
                }
            }
            Err(e) => eprintln!("warn: WORLD{i}.LZS: {e}"),
        }
    }

    println!(
        "exported {level_count} levels + {world_palettes} world palettes -> {}",
        out_dir.display()
    );
    Ok(())
}
