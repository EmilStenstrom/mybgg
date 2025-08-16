#!/usr/bin/env python3
"""
Simple validation script to check if setup is correct before running the main script.
"""

import sys
from pathlib import Path
from urllib.parse import unquote

# Add the scripts directory to the path so we can import gamecache modules
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Now import after path is set
from gamecache.config import parse_config_file  # noqa: E402
from gamecache.http_client import make_http_request  # noqa: E402

def validate_config():
    """Validate the config.ini file"""
    config_path = Path("config.ini")

    if not config_path.exists():
        print("❌ config.ini not found!")
        print("   Make sure you're running this from the GameCache directory")
        return False

    try:
        config = parse_config_file("config.ini")
    except FileNotFoundError:
        print("❌ config.ini not found!")
        return False
    except ValueError as e:
        print("❌ config.ini has invalid syntax!")
        print(f"   Error: {e}")
        return False
    except Exception as e:
        print("❌ Error reading config.ini!")
        print(f"   Error: {e}")
        return False

    # Check required fields
    required_fields = ["title", "bgg_username", "github_repo"]

    for field in required_fields:
        if field not in config:
            print(f"❌ Missing field '{field}' in config.ini")
            return False

        value = config[field]
        if not value or "YOUR_" in str(value).upper():
            print(f"❌ Please replace placeholder: {field}")
            print(f"   Current value: {value}")
            return False

    print("✅ config.ini looks good!")

    # Convert flat config to nested structure for compatibility with other functions
    nested_config = {
        "project": {"title": config["title"]},
        "boardgamegeek": {"user_name": config["bgg_username"]},
        "github": {"repo": config["github_repo"]}
    }
    return True, nested_config

def validate_bgg_user(username):
    """Check if BGG username exists and has a public collection"""
    print(f"🔍 Checking BGG user '{username}'...")
    safe_username = unquote(username)

    try:
        # Check user exists
        url = "https://boardgamegeek.com/xmlapi2/user"
        response = make_http_request(url, params={"name": safe_username}, timeout=10)

        # Check collection exists and is public
        url = "https://boardgamegeek.com/xmlapi2/collection"
        response = make_http_request(url, params={"username": safe_username, "own": 1}, timeout=10)

        # Basic check for collection content
        if b"<item " in response:
            print(f"✅ BGG user '{username}' found with accessible collection!")
        else:
            print(f"⚠️  BGG user '{username}' found but collection appears empty")
            print("   Make sure you have games marked as 'owned' in your BGG collection")

        return True

    except Exception as e:
        print(f"❌ Error checking BGG user: {e}")
        print("   Check your internet connection and BGG username")
        return False

def validate_python_deps():
    """Check if required Python packages are installed"""
    print("🔍 Checking Python dependencies...")

    # Read requirements from requirements.in file
    requirements_path = Path("scripts/requirements.in")
    try:
        with open(requirements_path) as f:
            required_packages = []
            for line in f:
                line = line.strip()
                # Skip empty lines and comments
                if line and not line.startswith('#'):
                    # Handle package names with version specifiers
                    package_name = line.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0]
                    required_packages.append(package_name.strip())
    except Exception as e:
        print(f"❌ Error reading requirements.in: {e}")
        print("   Make sure you run this from the GameCache directory")
        return False

    missing = []
    for package in required_packages:
        try:
            # Handle package names that import differently than their pip name
            import_name = package

            # Special cases for packages that import differently
            if package == "pillow":
                import_name = "PIL"
            elif package == "pynacl":
                import_name = "nacl"
            elif "-" in package:
                import_name = package.replace("-", "_")
            elif "." in package:
                import_name = package.replace(".", "_")

            __import__(import_name)
        except ImportError:
            missing.append(package)

    if missing:
        print(f"❌ Missing Python packages: {', '.join(missing)}")
        print("   Run: pip install -r scripts/requirements.txt")
        return False

    print("✅ All Python dependencies are installed!")
    return True

def main():
    print("🧪 Validating GameCache setup...\n")

    all_good = True

    # Validate config
    result = validate_config()
    if isinstance(result, tuple):
        config_valid, config = result
        all_good &= config_valid
    else:
        all_good = False
        return

    print()

    # Validate Python dependencies
    all_good &= validate_python_deps()
    print()

    # Validate BGG user
    if config_valid:
        bgg_username = config["boardgamegeek"]["user_name"]
        all_good &= validate_bgg_user(bgg_username)

    print("\n" + "=" * 50)

    if all_good:
        print("🎉 Setup validation passed!")
        print("You're ready to run: python scripts/download_and_index.py --cache_bgg")
    else:
        print("❌ Setup validation failed!")
        print("Please fix the issues above before running the main script.")
        sys.exit(1)


if __name__ == "__main__":
    main()
