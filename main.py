from pathlib import Path

import pygame
import math
import random


pygame.init()

SCREEN_WIDTH = 800
SCREEN_HEIGHT = 600
WINDOWED_SIZE = (SCREEN_WIDTH, SCREEN_HEIGHT)
WORLD_WIDTH = 2400
WORLD_HEIGHT = 1800
BACKGROUND_TILE_SIZE = 96
PLAYER_SIZE = (58, 58)
WOOD_SIZE = (104, 139)
PLAYER_SPEED = 240  # pixels per second
HARVEST_DISTANCE = 105
HARVEST_DURATION = 1.0
UNIT_SIZE = (48, 48)
UNIT_SPEED = 105
UNIT_CHOP_DISTANCE = 75
UNIT_CHOP_DURATION = 2.5
UNIT_WORK_RADIUS = 600
DEFENDER_SPEED = 105
RAIDER_SPEED = 82
DEFENSE_RADIUS = 390
RAIDER_COUNT = 9

screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("Click to move")
clock = pygame.time.Clock()
fullscreen = False


def toggle_fullscreen():
    global fullscreen, screen, SCREEN_WIDTH, SCREEN_HEIGHT
    fullscreen = not fullscreen
    if fullscreen:
        screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
    else:
        screen = pygame.display.set_mode(WINDOWED_SIZE)
    SCREEN_WIDTH, SCREEN_HEIGHT = screen.get_size()

# Load the Tiny Swords sprites from the asset pack.
asset_dir = Path(__file__).resolve().parent
pack_dir = asset_dir / "Tiny Swords (Free Pack)"


def load_frames(relative_path, frame_size=(192, 192), output_size=None):
    sheet = pygame.image.load(pack_dir / relative_path).convert_alpha()
    frame_width, frame_height = frame_size
    frames = []
    for x in range(0, sheet.get_width(), frame_width):
        frame = sheet.subsurface((x, 0, frame_width, frame_height)).copy()
        if output_size:
            frame = pygame.transform.scale(frame, output_size)
        frames.append(frame)
    return frames


# Use the grassy interior of the atlas as a repeating ground tile.
terrain_atlas = pygame.image.load(
    pack_dir / "Terrain" / "Tileset" / "Tilemap_color1.png"
).convert_alpha()
background = terrain_atlas.subsurface((64, 64, 64, 64)).copy()
background = pygame.transform.scale(background, (BACKGROUND_TILE_SIZE, BACKGROUND_TILE_SIZE))

player_idle_frames = load_frames(
    Path("Units") / "Blue Units" / "Pawn" / "Pawn_Idle Axe.png",
    output_size=PLAYER_SIZE,
)
player_run_frames = load_frames(
    Path("Units") / "Blue Units" / "Pawn" / "Pawn_Run Axe.png",
    output_size=PLAYER_SIZE,
)
player_chop_frames = load_frames(
    Path("Units") / "Blue Units" / "Pawn" / "Pawn_Interact Axe.png",
    output_size=PLAYER_SIZE,
)
worker_idle_frames = load_frames(
    Path("Units") / "Yellow Units" / "Pawn" / "Pawn_Idle Axe.png",
    output_size=UNIT_SIZE,
)
worker_run_frames = load_frames(
    Path("Units") / "Yellow Units" / "Pawn" / "Pawn_Run Axe.png",
    output_size=UNIT_SIZE,
)
worker_chop_frames = load_frames(
    Path("Units") / "Yellow Units" / "Pawn" / "Pawn_Interact Axe.png",
    output_size=UNIT_SIZE,
)
unit_image = worker_idle_frames[0]
player_image = player_idle_frames[0]
player_anim_time = 0.0


def troop_frames(team, troop, animation, size=UNIT_SIZE):
    return load_frames(
        Path("Units") / team / troop / f"{troop}_{animation}.png",
        output_size=size,
    )


defender_warrior_idle = troop_frames("Yellow Units", "Warrior", "Idle")
defender_warrior_run = troop_frames("Yellow Units", "Warrior", "Run")
defender_warrior_attack = troop_frames("Yellow Units", "Warrior", "Attack1")
defender_archer_idle = troop_frames("Yellow Units", "Archer", "Idle")
defender_archer_run = troop_frames("Yellow Units", "Archer", "Run")
defender_archer_attack = troop_frames("Yellow Units", "Archer", "Shoot")
raider_idle = troop_frames("Red Units", "Warrior", "Idle")
raider_run = troop_frames("Red Units", "Warrior", "Run")
raider_attack = troop_frames("Red Units", "Warrior", "Attack1")

tree_frame_sets = []
for tree_name, tree_frame_height in (
    ("Tree1.png", 256),
    ("Tree2.png", 256),
    ("Tree3.png", 192),
    ("Tree4.png", 192),
):
    tree_frame_sets.append(
        load_frames(
            Path("Terrain") / "Resources" / "Wood" / "Trees" / tree_name,
            frame_size=(192, tree_frame_height),
            output_size=WOOD_SIZE,
        )
    )
stump_images = [
    pygame.transform.scale(
        pygame.image.load(
            pack_dir / "Terrain" / "Resources" / "Wood" / "Trees" / f"Stump {i}.png"
        ).convert_alpha(),
        (78, 104),
    )
    for i in range(1, 5)
]
HOME_SIZE = (92, 138)
home_image = pygame.image.load(
    pack_dir / "Buildings" / "Yellow Buildings" / "House1.png"
).convert_alpha()
home_image = pygame.transform.scale(home_image, HOME_SIZE)
work_radius_diameter = UNIT_WORK_RADIUS * 2
work_radius_visual = pygame.Surface(
    (work_radius_diameter, work_radius_diameter), pygame.SRCALPHA
)
pygame.draw.circle(
    work_radius_visual,
    (100, 220, 130, 24),
    (UNIT_WORK_RADIUS, UNIT_WORK_RADIUS),
    UNIT_WORK_RADIUS,
)
pygame.draw.circle(
    work_radius_visual,
    (130, 245, 155, 150),
    (UNIT_WORK_RADIUS, UNIT_WORK_RADIUS),
    UNIT_WORK_RADIUS,
    3,
)

player_pos = pygame.Vector2(80, 80)
player_rect = player_image.get_rect(center=player_pos)
target = None
marker_time = 0.0


def generate_forest(tree_count=75):
    """Generate a fresh forest at random positions, with room around the base."""
    rng = random.Random()
    trees = []
    base = pygame.Vector2(180, 190)
    attempts = 0
    while len(trees) < tree_count and attempts < tree_count * 200:
        attempts += 1
        candidate = pygame.Vector2(
            rng.randint(60, WORLD_WIDTH - 60),
            rng.randint(120, WORLD_HEIGHT - 10),
        )
        if candidate.distance_to(base) < 280:
            continue
        if all(candidate.distance_to(tree) >= 105 for tree in trees):
            trees.append(candidate)
    return trees


woods = generate_forest()
tree_visuals = {
    id(tree): random.choice(tree_frame_sets)
    for tree in woods
}
stumps = []
harvesting = None
harvest_time = 0.0
wood_count = 0
base_house = pygame.Vector2(180, 190)
houses = []
placing_house = False
font = pygame.font.Font(None, 30)


class Worker:
    def __init__(self, position, home_position):
        self.pos = pygame.Vector2(position)
        self.home = pygame.Vector2(home_position)
        self.tree = None
        self.chop_time = 0.0
        self.anim_time = random.random()
        self.is_moving = False


class Settlement:
    def __init__(self, position):
        self.pos = pygame.Vector2(position)
        self.hp = 500
        self.max_hp = 500


class Defender:
    def __init__(self, settlement, role, offset):
        self.settlement = settlement
        self.role = role  # "archer" or "warrior"
        self.pos = settlement.pos + pygame.Vector2(offset)
        self.hp = 100
        self.max_hp = 100
        self.attack_cooldown = random.uniform(0.1, 0.8)
        self.attack_flash = 0.0
        self.anim_time = random.random()
        self.is_moving = False


class Raider:
    def __init__(self, position):
        self.pos = pygame.Vector2(position)
        self.hp = 120
        self.max_hp = 120
        self.attack_cooldown = random.uniform(0.2, 1.0)
        self.attack_flash = 0.0
        self.anim_time = random.random()
        self.is_moving = False


def generate_raiders(settlements, count=RAIDER_COUNT):
    """Create independent barbarian raiding parties near the map borders."""
    rng = random.Random()
    spawn_points = []
    attempts = 0
    while len(spawn_points) < count and attempts < count * 100:
        attempts += 1
        side = rng.randrange(4)
        if side == 0:
            candidate = pygame.Vector2(40, rng.randint(50, WORLD_HEIGHT - 50))
        elif side == 1:
            candidate = pygame.Vector2(WORLD_WIDTH - 40, rng.randint(50, WORLD_HEIGHT - 50))
        elif side == 2:
            candidate = pygame.Vector2(rng.randint(50, WORLD_WIDTH - 50), 40)
        else:
            candidate = pygame.Vector2(rng.randint(50, WORLD_WIDTH - 50), WORLD_HEIGHT - 40)
        if min(candidate.distance_to(settlement.pos) for settlement in settlements) >= 650:
            spawn_points.append(candidate)
    return [Raider(point) for point in spawn_points]


# The starting settlement has woodcutters, a warrior, and an archer.
base_settlement = Settlement(base_house)
houses = [base_settlement]
units = [
    Worker(base_house + pygame.Vector2(-24, 24), base_house),
    Worker(base_house + pygame.Vector2(24, 24), base_house),
]
defenders = [
    Defender(base_settlement, "warrior", (-36, 30)),
    Defender(base_settlement, "archer", (36, 30)),
]
raiders = generate_raiders(houses)
combat_effects = []


def get_camera_offset():
    """Keep the player centered, while keeping the camera inside the map."""
    return pygame.Vector2(
        max(0, min(player_pos.x - SCREEN_WIDTH / 2, WORLD_WIDTH - SCREEN_WIDTH)),
        max(0, min(player_pos.y - SCREEN_HEIGHT / 2, WORLD_HEIGHT - SCREEN_HEIGHT)),
    )


def draw_health_bar(position, health, max_health, width=42):
    screen_x = round(position.x - camera.x)
    screen_y = round(position.y - camera.y)
    ratio = max(0.0, min(1.0, health / max_health))
    rect = pygame.Rect(screen_x - width // 2, screen_y, width, 6)
    pygame.draw.rect(screen, (35, 25, 25), rect)
    fill_color = (70, 210, 85) if ratio > 0.5 else (235, 180, 55) if ratio > 0.25 else (220, 55, 55)
    pygame.draw.rect(screen, fill_color, (rect.x + 1, rect.y + 1, int((width - 2) * ratio), 4))
    pygame.draw.rect(screen, (20, 20, 20), rect, 1)


camera = get_camera_offset()

running = True
while running:
    dt = clock.tick(60) / 1000
    fullscreen_button_rect = pygame.Rect(SCREEN_WIDTH - 154, 12, 142, 40)

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_F11:
            toggle_fullscreen()
        elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            if fullscreen_button_rect.collidepoint(event.pos):
                toggle_fullscreen()
                continue
            clicked_world = pygame.Vector2(event.pos) + camera
            if placing_house:
                if wood_count >= 10:
                    new_settlement = Settlement(clicked_world)
                    houses.append(new_settlement)
                    units.append(Worker(clicked_world + pygame.Vector2(-24, 24), clicked_world))
                    units.append(Worker(clicked_world + pygame.Vector2(24, 24), clicked_world))
                    defenders.append(Defender(new_settlement, "warrior", (-36, 30)))
                    defenders.append(Defender(new_settlement, "archer", (36, 30)))
                    wood_count -= 10
                placing_house = False
            else:
                target = clicked_world
                marker_time = 0.0
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_e:
            # Start harvesting the closest tree within reach.
            if harvesting is None and woods:
                closest = min(woods, key=lambda tree: tree.distance_to(player_pos))
                if closest.distance_to(player_pos) <= HARVEST_DISTANCE:
                    harvesting = closest
                    harvest_time = 0.0
                    target = None
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_h:
            if wood_count >= 10:
                placing_house = True
                target = None
        elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
            placing_house = False

    if target is not None:
        direction = target - player_pos
        distance = direction.length()
        step = PLAYER_SPEED * dt
        if distance <= step:
            player_pos.update(target)
            target = None
        elif distance > 0:
            player_pos += direction / distance * step
        player_pos.x = max(PLAYER_SIZE[0] / 2, min(player_pos.x, WORLD_WIDTH - PLAYER_SIZE[0] / 2))
        player_pos.y = max(PLAYER_SIZE[1] / 2, min(player_pos.y, WORLD_HEIGHT - PLAYER_SIZE[1] / 2))
        player_rect.center = round(player_pos.x), round(player_pos.y)

    camera = get_camera_offset()

    if harvesting is not None:
        harvest_time += dt
        if harvest_time >= HARVEST_DURATION:
            woods.remove(harvesting)
            tree_visuals.pop(id(harvesting), None)
            stumps.append((harvesting, random.choice(stump_images)))
            harvesting = None
            wood_count += 1

    # Workers independently find trees, walk to them, and chop until each tree
    # is collected. Reserve targets so workers spread across available trees.
    claimed_trees = []
    chopping_trees = []
    for unit in units:
        unit.anim_time += dt
        unit.is_moving = False
        if unit.tree not in woods or unit.tree is harvesting:
            unit.tree = None
            unit.chop_time = 0.0

        if unit.tree is None:
            available_trees = [
                tree for tree in woods
                if tree is not harvesting
                and tree not in claimed_trees
                and tree.distance_to(unit.home) <= UNIT_WORK_RADIUS
            ]
            if available_trees:
                unit.tree = min(available_trees, key=lambda tree: unit.pos.distance_to(tree))

        if unit.tree is None:
            continue

        if unit.tree not in claimed_trees:
            claimed_trees.append(unit.tree)
        distance = unit.pos.distance_to(unit.tree)
        if distance > UNIT_CHOP_DISTANCE + 0.5:
            unit.is_moving = True
            direction = (unit.tree - unit.pos).normalize()
            step = UNIT_SPEED * dt
            remaining = distance - UNIT_CHOP_DISTANCE
            if remaining <= step + 0.5:
                # Snap to the work radius so floating point rounding cannot
                # leave a worker endlessly inching toward the tree.
                unit.pos = unit.tree - direction * UNIT_CHOP_DISTANCE
            else:
                unit.pos += direction * step
            unit.chop_time = 0.0
        else:
            unit.chop_time += dt
            if unit.tree not in chopping_trees:
                chopping_trees.append(unit.tree)
            if unit.chop_time >= UNIT_CHOP_DURATION:
                woods.remove(unit.tree)
                tree_visuals.pop(id(unit.tree), None)
                stumps.append((unit.tree, random.choice(stump_images)))
                wood_count += 1
                if unit.tree in claimed_trees:
                    claimed_trees.remove(unit.tree)
                unit.tree = None
                unit.chop_time = 0.0

    # Barbarians advance on the nearest settlement and fight its guards.
    for raider in raiders:
        raider.anim_time += dt
        raider.attack_cooldown = max(0.0, raider.attack_cooldown - dt)
        raider.attack_flash = max(0.0, raider.attack_flash - dt)
        raider.is_moving = False
        if not houses:
            continue

        target_house = min(houses, key=lambda house: raider.pos.distance_to(house.pos))
        nearby_defenders = [
            guard for guard in defenders
            if guard.hp > 0 and guard.settlement is target_house
        ]
        guard_target = min(
            nearby_defenders,
            key=lambda guard: raider.pos.distance_to(guard.pos),
            default=None,
        )

        if guard_target is not None and raider.pos.distance_to(guard_target.pos) <= 54:
            if raider.attack_cooldown <= 0:
                guard_target.hp -= 12
                raider.attack_cooldown = 1.0
                raider.attack_flash = 0.35
        else:
            distance_to_house = raider.pos.distance_to(target_house.pos)
            if distance_to_house <= 72:
                if raider.attack_cooldown <= 0:
                    target_house.hp -= 16
                    raider.attack_cooldown = 1.2
                    raider.attack_flash = 0.35
            else:
                direction = target_house.pos - raider.pos
                raider.pos += direction.normalize() * min(RAIDER_SPEED * dt, distance_to_house - 72)
                raider.is_moving = True

    # Settlement archers fire from range; warriors move out to intercept.
    for guard in defenders:
        guard.anim_time += dt
        guard.attack_cooldown = max(0.0, guard.attack_cooldown - dt)
        guard.attack_flash = max(0.0, guard.attack_flash - dt)
        guard.is_moving = False
        if guard.hp <= 0 or guard.settlement not in houses:
            continue

        threats = [
            raider for raider in raiders
            if raider.hp > 0
            and raider.pos.distance_to(guard.settlement.pos) <= DEFENSE_RADIUS
        ]
        if not threats:
            continue
        enemy = min(threats, key=lambda raider: guard.pos.distance_to(raider.pos))
        distance = guard.pos.distance_to(enemy.pos)
        attack_range = 245 if guard.role == "archer" else 58

        if distance > attack_range:
            direction = enemy.pos - guard.pos
            guard.pos += direction.normalize() * min(DEFENDER_SPEED * dt, distance - attack_range)
            guard.is_moving = True
        elif guard.attack_cooldown <= 0:
            enemy.hp -= 18 if guard.role == "archer" else 26
            guard.attack_cooldown = 1.15 if guard.role == "archer" else 0.9
            guard.attack_flash = 0.35
            if guard.role == "archer":
                combat_effects.append((pygame.Vector2(guard.pos), pygame.Vector2(enemy.pos), 0.16))

    raiders = [raider for raider in raiders if raider.hp > 0]
    defenders = [guard for guard in defenders if guard.hp > 0]
    destroyed_houses = [house for house in houses if house.hp <= 0]
    for destroyed in destroyed_houses:
        houses.remove(destroyed)
        defenders = [guard for guard in defenders if guard.settlement is not destroyed]
        units = [worker for worker in units if worker.home != destroyed.pos]

    combat_effects = [
        (start, end, life - dt)
        for start, end, life in combat_effects
        if life - dt > 0
    ]

    # Tile the background across the larger world, then draw only the camera view.
    tile_x = int(camera.x // BACKGROUND_TILE_SIZE) * BACKGROUND_TILE_SIZE
    tile_y = int(camera.y // BACKGROUND_TILE_SIZE) * BACKGROUND_TILE_SIZE
    for world_y in range(tile_y, int(camera.y + SCREEN_HEIGHT) + BACKGROUND_TILE_SIZE, BACKGROUND_TILE_SIZE):
        for world_x in range(tile_x, int(camera.x + SCREEN_WIDTH) + BACKGROUND_TILE_SIZE, BACKGROUND_TILE_SIZE):
            screen.blit(background, (round(world_x - camera.x), round(world_y - camera.y)))

    for stump_pos, stump_image in stumps:
        stump_rect = stump_image.get_rect(
            midbottom=(round(stump_pos.x - camera.x), round(stump_pos.y - camera.y))
        )
        screen.blit(stump_image, stump_rect)

    # Each house has its own visible worker boundary.
    for house in houses:
        radius_center = house.pos + pygame.Vector2(0, -HOME_SIZE[1] / 2)
        screen.blit(
            work_radius_visual,
            (
                round(radius_center.x - camera.x - UNIT_WORK_RADIUS),
                round(radius_center.y - camera.y - UNIT_WORK_RADIUS),
            ),
        )
        house_rect = home_image.get_rect(
            midbottom=(round(house.pos.x - camera.x), round(house.pos.y - camera.y))
        )
        screen.blit(home_image, house_rect)
        draw_health_bar(house.pos + pygame.Vector2(0, -HOME_SIZE[1] - 5), house.hp, house.max_hp, 68)

    if placing_house:
        preview = home_image.copy()
        preview.set_alpha(155)
        preview_rect = preview.get_rect(midbottom=pygame.mouse.get_pos())
        screen.blit(preview, preview_rect)

    # Draw trees; the one being harvested shakes slightly.
    for tree in woods:
        frames = tree_visuals[id(tree)]
        if tree is harvesting or tree in chopping_trees:
            frame_index = (pygame.time.get_ticks() // 110) % len(frames)
        else:
            frame_index = 0
        tree_image = frames[frame_index]
        tree_rect = tree_image.get_rect(
            midbottom=(round(tree.x - camera.x), round(tree.y - camera.y))
        )
        if tree is harvesting or tree in chopping_trees:
            shake = math.sin(harvest_time * 42) * 4
            if tree in chopping_trees:
                shake = math.sin(pygame.time.get_ticks() * 0.045) * 4
            tree_rect.x += round(shake)
        screen.blit(tree_image, tree_rect)

    # Draw workers over the lower tree canopy so their chopping animation stays visible.
    for unit in units:
        unit_rect = unit_image.get_rect(
            center=(round(unit.pos.x - camera.x), round(unit.pos.y - camera.y))
        )
        if unit.tree is not None and unit.tree in chopping_trees:
            frames = worker_chop_frames
            frame_index = min(
                int(unit.chop_time / UNIT_CHOP_DURATION * len(frames)), len(frames) - 1
            )
        elif unit.is_moving:
            frames = worker_run_frames
            frame_index = int(unit.anim_time * 10) % len(frames)
        else:
            frames = worker_idle_frames
            frame_index = int(unit.anim_time * 3) % len(frames)
        screen.blit(frames[frame_index], unit_rect)

    # Draw defenders and barbarian raiders with visible health bars.
    for guard in defenders:
        if guard.role == "archer":
            idle_frames, run_frames, attack_frames = (
                defender_archer_idle, defender_archer_run, defender_archer_attack
            )
        else:
            idle_frames, run_frames, attack_frames = (
                defender_warrior_idle, defender_warrior_run, defender_warrior_attack
            )
        if guard.attack_flash > 0:
            frames = attack_frames
            frame_index = int((0.35 - guard.attack_flash) * 18) % len(frames)
        elif guard.is_moving:
            frames = run_frames
            frame_index = int(guard.anim_time * 10) % len(frames)
        else:
            frames = idle_frames
            frame_index = int(guard.anim_time * 3) % len(frames)
        guard_rect = frames[frame_index].get_rect(
            center=(round(guard.pos.x - camera.x), round(guard.pos.y - camera.y))
        )
        screen.blit(frames[frame_index], guard_rect)
        draw_health_bar(guard.pos + pygame.Vector2(0, -30), guard.hp, guard.max_hp)

    for raider in raiders:
        if raider.attack_flash > 0:
            frames = raider_attack
            frame_index = int((0.35 - raider.attack_flash) * 18) % len(frames)
        elif raider.is_moving:
            frames = raider_run
            frame_index = int(raider.anim_time * 10) % len(frames)
        else:
            frames = raider_idle
            frame_index = int(raider.anim_time * 3) % len(frames)
        raider_rect = frames[frame_index].get_rect(
            center=(round(raider.pos.x - camera.x), round(raider.pos.y - camera.y))
        )
        screen.blit(frames[frame_index], raider_rect)
        draw_health_bar(raider.pos + pygame.Vector2(0, -30), raider.hp, raider.max_hp)

    for start, end, _life in combat_effects:
        pygame.draw.line(
            screen,
            (255, 235, 120),
            (round(start.x - camera.x), round(start.y - camera.y)),
            (round(end.x - camera.x), round(end.y - camera.y)),
            2,
        )

    if target is not None:
        marker_time += dt
        marker_center = (round(target.x - camera.x), round(target.y - camera.y))
        pulse = 3 + int((marker_time * 5) % 7)
        pygame.draw.circle(screen, (255, 255, 255), marker_center, 12, 2)
        pygame.draw.circle(screen, (255, 75, 65), marker_center, pulse, 2)
        pygame.draw.circle(screen, (255, 75, 65), marker_center, 3)

    player_anim_time += dt
    if harvesting is not None:
        player_frames = player_chop_frames
        player_frame_index = min(
            int(harvest_time / HARVEST_DURATION * len(player_frames)), len(player_frames) - 1
        )
    elif target is not None:
        player_frames = player_run_frames
        player_frame_index = int(player_anim_time * 10) % len(player_frames)
    else:
        player_frames = player_idle_frames
        player_frame_index = int(player_anim_time * 3) % len(player_frames)
    screen.blit(
        player_frames[player_frame_index],
        player_rect.move(-round(camera.x), -round(camera.y)),
    )

    # Small status panel with controls and collected wood.
    panel = pygame.Surface((290, 156), pygame.SRCALPHA)
    panel.fill((20, 25, 24, 185))
    screen.blit(panel, (12, 12))
    screen.blit(font.render(f"Wood: {wood_count} | Workers: {len(units)}", True, (255, 255, 255)), (24, 20))
    screen.blit(font.render(f"Trees remaining: {len(woods)}", True, (220, 245, 220)), (24, 45))
    screen.blit(font.render("E: harvest nearby tree", True, (220, 230, 220)), (24, 70))
    screen.blit(font.render("H: build house (10 wood)", True, (220, 230, 220)), (24, 92))
    screen.blit(font.render("Workers stay in green circle", True, (160, 245, 175)), (24, 114))
    screen.blit(font.render(f"Raiders: {len(raiders)} | Guards: {len(defenders)}", True, (255, 180, 150)), (24, 136))

    if placing_house:
        prompt = font.render("Click to place house | Esc to cancel", True, (255, 245, 170))
        screen.blit(prompt, prompt.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT - 28)))

    pygame.draw.rect(screen, (34, 70, 48), fullscreen_button_rect, border_radius=8)
    pygame.draw.rect(screen, (150, 220, 160), fullscreen_button_rect, 2, border_radius=8)
    button_label = "Exit fullscreen" if fullscreen else "Fullscreen"
    button_text = pygame.font.Font(None, 24).render(button_label, True, (245, 255, 245))
    screen.blit(button_text, button_text.get_rect(center=fullscreen_button_rect.center))

    if woods and harvesting is None:
        nearest = min(woods, key=lambda tree: tree.distance_to(player_pos))
        if nearest.distance_to(player_pos) <= HARVEST_DISTANCE:
            prompt = font.render("Press E to harvest", True, (255, 245, 170))
            screen.blit(prompt, prompt.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT - 28)))
    pygame.display.flip()

pygame.quit()
