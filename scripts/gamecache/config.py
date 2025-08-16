"""
Configuration parsing utilities for GameCache project.
"""

from pathlib import Path


def parse_config_file(config_path="config.txt"):
    """Parse simple key=value config file"""
    config = {}
    config_file = Path(config_path)

    if not config_file.exists():
        raise FileNotFoundError(f"Config file {config_path} not found")

    with open(config_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()

            # Skip empty lines and comments
            if not line or line.startswith('#'):
                continue

            # Parse key=value
            if '=' not in line:
                raise ValueError(f"Invalid config line {line_num}: {line}")

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1]

            config[key] = value

    return config


def create_nested_config(config):
    """Convert flat config to nested structure for backward compatibility"""
    return {
        "project": {
            "title": config["title"]
        },
        "boardgamegeek": {
            "user_name": config["bgg_username"]
        },
        "github": {
            "repo": config["github_repo"]
        }
    }
