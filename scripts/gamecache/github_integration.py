import json
import os
import time
import webbrowser
import logging
import getpass
from pathlib import Path
from typing import Optional, Dict, Any
from .http_client import make_json_request, make_form_post


logger = logging.getLogger(__name__)


def _make_http_request(
    url: str,
    method: str = 'GET',
    data: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> Optional[Dict[str, Any]]:
    """Make HTTP request using our HTTP client and return JSON response."""
    logger.info(f"Making {method} request to URL: {url}")
    try:
        result = make_json_request(url, method, data, headers, timeout)
        if result is None:
            logger.warning(f"Request to {url} returned None (likely 404 or other error)")
        else:
            logger.debug(f"Request to {url} succeeded")
        return result
    except Exception as e:
        logger.error(f"Request to {url} failed with error: {e}")
        raise


def _make_http_post_form(
    url: str,
    data: Dict[str, str],
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> Optional[Dict[str, Any]]:
    """Make HTTP POST request with form data."""
    return make_form_post(url, data, headers, timeout)


def _make_http_post_json(
    url: str,
    data: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> Optional[Dict[str, Any]]:
    """Make HTTP POST request with JSON data."""
    if headers is None:
        headers = {}

    headers['Content-Type'] = 'application/json'
    json_data = json.dumps(data).encode('utf-8')

    return _make_http_request(url, 'POST', json_data, headers, timeout)


def _make_http_delete(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> bool:
    """Make HTTP DELETE request."""
    if headers is None:
        headers = {}
    try:
        _make_http_request(url, 'DELETE', None, headers, timeout)
        return True
    except Exception as e:
        msg = str(e)
        if 'HTTP 404' in msg:
            logger.info(f"DELETE {url} 404 (already gone) -> success")
            return True
        if 'HTTP 307' in msg:
            logger.info(f"DELETE {url} 307 redirect issue -> tolerating")
            return True
        logger.debug(f"DELETE failed {url}: {e}")
        return False


def _upload_file(
    url: str,
    file_data: bytes,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 60
) -> Optional[Dict[str, Any]]:
    """Upload file data to URL."""
    if headers is None:
        headers = {}

    return _make_http_request(url, 'POST', file_data, headers, timeout)


class GitHubAuth:
    """Handles GitHub OAuth Device Flow authentication."""

    def __init__(self, client_id: str):
        self.client_id = client_id
        # New path, with support for legacy path and one-time migration
        self.new_token_file = Path.home() / '.gamecache' / 'token.json'
        self.old_token_file = Path.home() / '.mybgg' / 'token.json'
        # Always save to the new path
        self.token_file = self.new_token_file
        self.token_file.parent.mkdir(exist_ok=True)
        # Internal flags/state for migration
        self._loaded_from_legacy = False
        self._loaded_token_data: Optional[Dict[str, Any]] = None
        self.token_file.parent.mkdir(exist_ok=True)

    def get_access_token(self) -> str:
        """Get a valid access token, refreshing if necessary."""
        # Try to load existing token
        logger.debug("Attempting to load existing token...")
        token_data = self._load_token()
        if token_data:
            logger.info("Found existing token, checking if it's still valid...")
            if self._is_token_valid(token_data):
                logger.info("✅ Using existing valid token")
                return token_data['access_token']
            else:
                logger.info("❌ Existing token is not valid, need to re-authenticate")
                print("Your existing GitHub token has expired or been revoked.")
                print("Need to re-authenticate...")
        else:
            logger.debug("No existing token found")

        # Need to authenticate
        if token_data:
            logger.info("Existing token expired, refreshing authentication...")
        else:
            logger.info("No token found, starting initial authentication...")
        return self._perform_device_flow()

    def _load_token(self) -> Optional[Dict[str, Any]]:
        """Load token from local storage."""
        try:
            # Prefer new token path
            if self.new_token_file.exists():
                with open(self.new_token_file, 'r') as f:
                    data = json.load(f)
                    self._loaded_from_legacy = False
                    self._loaded_token_data = data
                    return data
            # Fallback to legacy token path
            if self.old_token_file.exists():
                with open(self.old_token_file, 'r') as f:
                    data = json.load(f)
                    self._loaded_from_legacy = True
                    self._loaded_token_data = data
                    logger.info(
                        f"Loaded legacy token from {self.old_token_file}. Will migrate to "
                        f"{self.new_token_file} after validation."
                    )
                    return data
        except Exception as e:
            logger.warning(f"Failed to load token: {e}")
        return None

    def _save_token(self, token_data: Dict[str, Any]):
        """Save token to local storage with proper permissions."""
        try:
            logger.debug(f"_save_token called with token_data keys: {list(token_data.keys())}")
            logger.debug(f"Token file path: {self.token_file}")
            logger.debug(f"Token directory: {self.token_file.parent}")
            logger.debug(f"Token directory exists before mkdir: {self.token_file.parent.exists()}")

            # Ensure directory exists
            self.token_file.parent.mkdir(exist_ok=True)
            logger.debug(f"After mkdir - token directory exists: {self.token_file.parent.exists()}")

            # Check directory permissions
            if self.token_file.parent.exists():
                dir_stat = self.token_file.parent.stat()
                logger.debug(f"Directory permissions: {oct(dir_stat.st_mode)[-3:]}")
                logger.debug(f"Directory owner: {dir_stat.st_uid}")
                
                # Get current user info (cross-platform)
                if hasattr(os, 'getuid'):
                    logger.debug(f"Current user ID: {os.getuid()}")
                else:
                    # Windows fallback - get username for debugging
                    try:
                        username = getpass.getuser()
                        logger.debug(f"Current user: {username}")
                    except Exception:
                        logger.debug("Could not determine current user")

            logger.debug("Opening file for writing...")
            with open(self.token_file, 'w') as f:
                logger.debug("File opened, writing JSON...")
                json.dump(token_data, f, indent=2)
                logger.debug("JSON written, flushing...")
                f.flush()
                logger.debug("File flushed")

            logger.debug("Setting file permissions...")
            try:
                os.chmod(self.token_file, 0o600)
                logger.debug("File permissions set successfully")
            except (OSError, AttributeError) as e:
                logger.debug(f"Could not set file permissions (this is normal on Windows): {e}")

            # Verify the file was actually saved
            logger.debug("Checking if file exists...")
            file_exists = self.token_file.exists()
            logger.debug(f"Token file exists after write: {file_exists}")

            if file_exists:
                file_size = self.token_file.stat().st_size
                logger.debug(f"Token file size: {file_size} bytes")

                # Verify the content
                with open(self.token_file, 'r') as f:
                    saved_data = json.load(f)
                logger.debug(f"Verified saved token data keys: {list(saved_data.keys())}")
                logger.info(f"Token successfully saved to {self.token_file}")
                # If we originally loaded from legacy, attempt one-time migration copy
                if self._loaded_from_legacy and self.old_token_file.exists():
                    try:
                        # Leave legacy file as-is, but ensure new file now exists
                        logger.info(f"One-time migration complete. New token stored at {self.new_token_file}")
                        # Reset flag to avoid repeated messages
                        self._loaded_from_legacy = False
                    except Exception as e:
                        logger.warning(f"Token migration note: {e}")
            else:
                logger.error(f"Token file was not created at {self.token_file}")
                # List directory contents to see what's there
                dir_contents = os.listdir(self.token_file.parent)
                logger.error(f"Directory contents after write: {dir_contents}")

        except Exception as e:
            logger.error(f"Failed to save token: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            raise

    def _is_token_valid(self, token_data: Dict[str, Any]) -> bool:
        """Check if the token is still valid by making a test API call."""
        try:
            headers = {'Authorization': f"Bearer {token_data['access_token']}"}
            logger.debug("Testing token validity with GitHub API...")
            logger.info("Testing token validity by calling https://api.github.com/user")
            response = _make_http_request('https://api.github.com/user', headers=headers, timeout=10)
            if response is not None:
                logger.debug("Token validation successful")
                logger.info(f"Token is valid for user: {response.get('login', 'unknown')}")
                return True
            else:
                logger.info("Token validation failed: received None response (possibly 404)")
                return False
        except Exception as e:
            # Log as info since we want to see why validation failed
            error_msg = str(e)
            if "401" in error_msg or "Unauthorized" in error_msg:
                logger.info("Token validation failed: Token is no longer valid (401 Unauthorized)")
                logger.info("This usually means the token has expired or been revoked")
            elif "403" in error_msg or "Forbidden" in error_msg:
                logger.info("Token validation failed: Token lacks required permissions (403 Forbidden)")
            else:
                logger.info(f"Token validation failed: {error_msg}")
            return False

    def _perform_device_flow(self) -> str:
        """Perform the complete OAuth Device Flow."""
        # Step 1: Request device and user codes
        device_data = _make_http_post_form(
            'https://github.com/login/device/code',
            {
                'client_id': self.client_id,
                'scope': 'public_repo'  # Request permission to create releases on public repos
            },
            headers={'Accept': 'application/json'},
            timeout=10
        )

        if not device_data:
            raise Exception("Failed to get device code from GitHub")

        # Step 2: Show user code and open browser
        user_code = device_data['user_code']
        verification_uri = device_data['verification_uri']

        print(f"\nPlease visit: {verification_uri}")
        print(f"And enter the code: {user_code}")
        print("Opening browser...")

        try:
            webbrowser.open(verification_uri)
        except Exception as e:
            logger.warning(f"Failed to open browser: {e}")

        # Step 3: Poll for access token
        device_code = device_data['device_code']
        interval = device_data.get('interval', 5)
        expires_in = device_data.get('expires_in', 900)

        print(f"Waiting for authorization... (timeout in {expires_in // 60} minutes)")

        start_time = time.time()
        while time.time() - start_time < expires_in:
            time.sleep(interval)

            token_data = _make_http_post_form(
                'https://github.com/login/oauth/access_token',
                {
                    'client_id': self.client_id,
                    'device_code': device_code,
                    'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'
                },
                headers={'Accept': 'application/json'},
                timeout=10
            )

            if token_data and 'access_token' in token_data:
                logger.info("Authorization successful!")
                logger.debug("About to save token...")
                self._save_token(token_data)
                logger.debug("Token save completed")
                return token_data['access_token']
            elif token_data and token_data.get('error') == 'authorization_pending':
                continue
            elif token_data and token_data.get('error') == 'slow_down':
                interval += 5
                continue
            elif token_data and token_data.get('error'):
                raise Exception(f"OAuth error: {token_data.get('error_description', 'Unknown error')}")

        raise Exception("OAuth Device Flow timed out")


class GitHubReleaseManager:
    """Manages GitHub releases and assets."""

    def __init__(self, repo: str, token: str):
        self.repo = repo  # format: owner/repo
        self.token = token
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        self.base_url = 'https://api.github.com'

    def upload_snapshot(self, file_path: str, tag: str = 'snapshot', asset_name: str = 'gamecache.sqlite.gz'):
        """Upload a file as a snapshot release asset."""
        logger.info(f"Uploading {file_path} to GitHub release {tag}")
        logger.info(f"Using repository: {self.repo}")

        # Step 1: Find or create release
        release = self._find_or_create_release(tag)

        # Step 2: Delete existing asset if it exists
        self._delete_existing_asset(release, asset_name)

        # Step 3: Upload new asset
        self._upload_asset(release, file_path, asset_name)

        # Return the public download URL
        download_url = f"https://github.com/{self.repo}/releases/latest/download/{asset_name}"
        logger.info(f"Upload successful! Download URL: {download_url}")
        return download_url

    def _find_or_create_release(self, tag: str) -> Dict[str, Any]:
        """Find existing release or create a new one."""
        # Try to find existing release
        url = f"{self.base_url}/repos/{self.repo}/releases/tags/{tag}"
        logger.info(f"Checking for existing release at URL: {url}")
        try:
            response = _make_http_request(url, headers=self.headers, timeout=10)
            if response is not None:
                logger.info(f"Found existing release: {tag}")
                return response
            else:
                logger.info(f"No existing release found for tag: {tag}, will create new one")
        except Exception as e:
            logger.info(f"Error checking for existing release: {e}")
            logger.info("Will attempt to create new release")

        # Create new release
        logger.info(f"Creating new release: {tag}")
        create_url = f"{self.base_url}/repos/{self.repo}/releases"
        logger.info(f"Creating release at URL: {create_url}")
        release_data = {
            'tag_name': tag,
            'name': 'Board Game Collection Database',
            'body': 'Latest database of board game collection from BoardGameGeek',
            'draft': False,
            'prerelease': False
        }
        try:
            create_response = _make_http_post_json(create_url, release_data, headers=self.headers, timeout=10)
            if not create_response:
                raise Exception(f"Failed to create GitHub release at {create_url}")
            logger.info(f"Successfully created release: {tag}")
            return create_response
        except Exception as e:
            raise Exception(f"Failed to create GitHub release at {create_url}: {e}")

    def _delete_existing_asset(self, release: Dict[str, Any], asset_name: str):
        """Delete existing asset with the same name."""
        for asset in release.get('assets', []):
            if asset['name'] == asset_name:
                logger.info(f"Deleting existing asset: {asset_name}")
                delete_url = f"{self.base_url}/repos/{self.repo}/releases/assets/{asset['id']}"
                success = _make_http_delete(delete_url, headers=self.headers, timeout=10)
                if not success:
                    logger.warning(f"Failed to delete existing asset: {asset_name}")
                break

    def _upload_asset(self, release: Dict[str, Any], file_path: str, asset_name: str):
        """Upload asset to release."""
        upload_url = release['upload_url'].replace('{?name,label}', f'?name={asset_name}')

        with open(file_path, 'rb') as f:
            file_data = f.read()

        upload_headers = self.headers.copy()
        upload_headers['Content-Type'] = 'application/gzip'

        logger.info(f"Uploading {len(file_data):,} bytes...")
        try:
            _upload_file(upload_url, file_data, headers=upload_headers, timeout=60)
            logger.info("Asset upload successful!")
        except Exception as e:
            if 'HTTP 422' in str(e):
                logger.warning("422 duplicate? refreshing + retry once")
                refreshed = _make_http_request(
                    f"{self.base_url}/repos/{self.repo}/releases/{release['id']}",
                    headers=self.headers,
                    timeout=10,
                )
                if refreshed:
                    self._delete_existing_asset(refreshed, asset_name)
                    _upload_file(upload_url, file_data, headers=upload_headers, timeout=60)
                    logger.info("Asset upload successful on retry")
                else:
                    raise
            else:
                raise


def setup_github_integration(settings: Dict[str, Any]) -> GitHubReleaseManager:
    """Set up GitHub integration with OAuth Device Flow authentication."""
    github_config = settings['github']

    # Check if GAMECACHE_GITHUB_TOKEN or MYBGG_GITHUB_TOKEN environment variable is set (for CI/CD)
    github_token = os.environ.get('GAMECACHE_GITHUB_TOKEN') or os.environ.get('MYBGG_GITHUB_TOKEN')
    if github_token:
        source = 'GAMECACHE_GITHUB_TOKEN' if os.environ.get('GAMECACHE_GITHUB_TOKEN') else 'MYBGG_GITHUB_TOKEN'
        logger.info(f"Using {source} environment variable for authentication")
        return GitHubReleaseManager(github_config['repo'], github_token)

    # Use OAuth Device Flow for automatic authentication
    # Public client ID for the GameCache OAuth App
    public_client_id = "Ov23lir5tLSaSrWi0YMJ"

    logger.info("Using OAuth Device Flow for automatic authentication")
    print("\n🔐 Setting up GitHub authentication...")
    print("This will open your browser to authenticate with GitHub (no manual token creation needed!)")

    auth = GitHubAuth(public_client_id)
    token = auth.get_access_token()
    return GitHubReleaseManager(github_config['repo'], token)
