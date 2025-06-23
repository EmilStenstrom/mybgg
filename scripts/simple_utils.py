"""
Simple configuration utilities with no external dependencies
"""

import urllib.request
import urllib.parse
import urllib.error
import json
import xml.etree.ElementTree as ET
from pathlib import Path


def parse_config(config_path="config.txt"):
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


def http_get(url, timeout=30):
    """Simple HTTP GET using urllib"""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.read()
    except urllib.error.URLError as e:
        raise Exception(f"HTTP request failed: {e}")


def http_post(url, data=None, headers=None, timeout=30):
    """Simple HTTP POST using urllib"""
    if headers is None:
        headers = {}

    # Prepare request
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode('utf-8')
    elif isinstance(data, str):
        data = data.encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()
    except urllib.error.URLError as e:
        raise Exception(f"HTTP request failed: {e}")


def config_to_nested(config):
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
