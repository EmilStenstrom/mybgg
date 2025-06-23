import json
import os
import time
import webbrowser
import logging
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.request import urlopen, Request
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError


logger = logging.getLogger(__name__)


def _make_http_request(
    url: str,
    method: str = 'GET',
    data: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> Optional[Dict[str, Any]]:
    """Make HTTP request using urllib and return JSON response."""
    if headers is None:
        headers = {}

    # Set default headers
    headers.setdefault('User-Agent', 'MyBGG/1.0')
    headers.setdefault('Accept', 'application/json')

    req = Request(url, data=data, headers=headers, method=method)

    try:
        with urlopen(req, timeout=timeout) as response:
            content = response.read().decode('utf-8')
            if content:
                return json.loads(content)
            return {}
    except HTTPError as e:
        if e.code == 404:
            # For 404s, return None to indicate not found
            return None
        elif e.code == 200:
            # Sometimes 200 is returned even on HTTPError
            content = e.read().decode('utf-8')
            if content:
                return json.loads(content)
            return {}
        else:
            raise Exception(f"HTTP {e.code}: {e.reason}")
    except URLError as e:
        raise Exception(f"URL Error: {e.reason}")


def _make_http_post_form(
    url: str,
    data: Dict[str, str],
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 10
) -> Optional[Dict[str, Any]]:
    """Make HTTP POST request with form data."""
    if headers is None:
        headers = {}

    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    encoded_data = urlencode(data).encode('utf-8')

    return _make_http_request(url, 'POST', encoded_data, headers, timeout)


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
    except Exception:
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
        self.token_file = Path.home() / '.mybgg' / 'token.json'
        self.token_file.parent.mkdir(exist_ok=True)

    def get_access_token(self) -> str:
        """Get a valid access token, refreshing if necessary."""
        # Try to load existing token
        token_data = self._load_token()
        if token_data and self._is_token_valid(token_data):
            return token_data['access_token']

        # Need to authenticate
        logger.info("No valid token found, starting OAuth Device Flow...")
        return self._perform_device_flow()

    def _load_token(self) -> Optional[Dict[str, Any]]:
        """Load token from local storage."""
        try:
            if self.token_file.exists():
                with open(self.token_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load token: {e}")
        return None

    def _save_token(self, token_data: Dict[str, Any]):
        """Save token to local storage with proper permissions."""
        try:
            with open(self.token_file, 'w') as f:
                json.dump(token_data, f)
            # Set file permissions to 0600 (owner read/write only)
            os.chmod(self.token_file, 0o600)
            logger.info(f"Token saved to {self.token_file}")
        except Exception as e:
            logger.error(f"Failed to save token: {e}")
            raise

    def _is_token_valid(self, token_data: Dict[str, Any]) -> bool:
        """Check if the token is still valid by making a test API call."""
        try:
            headers = {'Authorization': f"token {token_data['access_token']}"}
            response = _make_http_request('https://api.github.com/user', headers=headers, timeout=10)
            return response is not None
        except Exception as e:
            logger.warning(f"Token validation failed: {e}")
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
                self._save_token(token_data)
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
            'Authorization': f'token {token}',
            'Accept': 'application/vnd.github.v3+json'
        }
        self.base_url = 'https://api.github.com'

    def upload_snapshot(self, file_path: str, tag: str = 'snapshot', asset_name: str = 'mybgg.sqlite.gz'):
        """Upload a file as a snapshot release asset."""
        logger.info(f"Uploading {file_path} to GitHub release {tag}")

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
        response = _make_http_request(url, headers=self.headers, timeout=10)

        if response is not None:
            logger.info(f"Found existing release: {tag}")
            return response
        else:
            # Create new release
            logger.info(f"Creating new release: {tag}")
            create_url = f"{self.base_url}/repos/{self.repo}/releases"
            release_data = {
                'tag_name': tag,
                'name': 'Board Game Collection Database',
                'body': 'Latest database of board game collection from BoardGameGeek',
                'draft': False,
                'prerelease': False
            }
            create_response = _make_http_post_json(create_url, release_data, headers=self.headers, timeout=10)
            if not create_response:
                raise Exception("Failed to create GitHub release")
            return create_response

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
        _upload_file(upload_url, file_data, headers=upload_headers, timeout=60)
        logger.info("Asset upload successful!")


def setup_github_integration(settings: Dict[str, Any]) -> GitHubReleaseManager:
    """Set up GitHub integration with OAuth Device Flow authentication."""
    github_config = settings['github']

    # Use OAuth Device Flow for automatic authentication
    # Public client ID for the MyBGG OAuth App
    public_client_id = "Ov23lir5tLSaSrWi0YMJ"

    logger.info("Using OAuth Device Flow for automatic authentication")
    print("\n🔐 Setting up GitHub authentication...")
    print("This will open your browser to authenticate with GitHub (no manual token creation needed!)")

    auth = GitHubAuth(public_client_id)
    token = auth.get_access_token()
    return GitHubReleaseManager(github_config['repo'], token)
