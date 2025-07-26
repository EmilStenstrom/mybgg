"""
HTTP client functionality for MyBGG project.
Provides simple HTTP functionality with caching capabilities.
"""

import urllib.request
import urllib.parse
import urllib.error
import json
import sqlite3
import hashlib
import time as time_module
import gzip


def make_http_request(url, params=None, timeout=30, headers=None):
    """Simple HTTP GET using urllib"""
    try:
        # URL encode params and add to URL
        if params:
            query_string = urllib.parse.urlencode(params)
            url += "?" + query_string

        # Create request with proper headers
        request = urllib.request.Request(url)
        request.add_header('Accept-Encoding', 'gzip, deflate')
        request.add_header('User-Agent', 'MyBGG/1.0')

        # Add any additional headers
        if headers:
            for key, value in headers.items():
                request.add_header(key, value)

        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()

            # Check if response is gzip compressed
            if response.info().get('Content-Encoding') == 'gzip':
                data = gzip.decompress(data)

            return data
    except urllib.error.URLError as e:
        raise Exception(f"HTTP request failed: {e}")


def make_http_post(url, data=None, headers=None, timeout=30):
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


class HttpResponse:
    """Simple response object that mimics requests.Response interface"""

    def __init__(self, content, headers, status_code, from_cache=False, url=None):
        self.content = content
        self.headers = headers
        self.status_code = status_code
        self.from_cache = from_cache
        self.url = url or "unknown"

        # For compatibility with existing code
        if isinstance(content, bytes):
            # Try to decode as UTF-8, fallback to latin-1 if that fails
            try:
                self.text = content.decode('utf-8')
            except UnicodeDecodeError:
                self.text = content.decode('latin-1', errors='ignore')
        else:
            self.text = str(content)

    def raise_for_status(self):
        """Raise an exception for bad status codes (like requests)"""
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code} Error")


class HttpSession:
    """Simple session-like class that mimics requests.Session interface"""

    def get(self, url, params=None, timeout=30):
        """GET request that mimics requests.Session.get()"""
        # Build full URL with parameters
        if params:
            param_str = urllib.parse.urlencode(params)
            full_url = f"{url}?{param_str}" if '?' not in url else f"{url}&{param_str}"
        else:
            full_url = url

        try:
            response_data = make_http_request(full_url, timeout=timeout)
            return HttpResponse(response_data, {}, 200, from_cache=False, url=full_url)
        except Exception as e:
            # Re-raise with status code info if possible
            raise Exception(f"HTTP request failed: {e}")


class CachedHttpClient:
    """HTTP client with SQLite-based caching"""

    def __init__(self, cache_name="http_cache", expire_after=3600):
        """
        Initialize cache with SQLite backend

        Args:
            cache_name: Name/path of the cache database
            expire_after: Cache TTL in seconds (default 1 hour)
        """
        # Only add .sqlite extension if not already present
        if cache_name.endswith('.sqlite'):
            self.cache_path = cache_name
        else:
            self.cache_path = f"{cache_name}.sqlite"
        self.expire_after = expire_after
        self._init_cache()

    def _init_cache(self):
        """Initialize the cache database"""
        conn = sqlite3.connect(self.cache_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS http_cache (
                url_hash TEXT PRIMARY KEY,
                url TEXT,
                response_data BLOB,
                headers TEXT,
                status_code INTEGER,
                timestamp REAL
            )
        """)
        conn.commit()
        conn.close()

    def _get_url_hash(self, url):
        """Generate a hash for the URL to use as cache key"""
        return hashlib.md5(url.encode('utf-8')).hexdigest()

    def _is_expired(self, timestamp):
        """Check if cache entry is expired"""
        return time_module.time() - timestamp > self.expire_after

    def get(self, url, timeout=30, params=None):
        """
        GET request with caching

        Args:
            url: URL to request
            timeout: Request timeout
            params: URL parameters (dict)

        Returns:
            HttpResponse object with response data
        """
        # Build full URL with parameters
        if params:
            param_str = urllib.parse.urlencode(params)
            full_url = f"{url}?{param_str}" if '?' not in url else f"{url}&{param_str}"
        else:
            full_url = url

        url_hash = self._get_url_hash(full_url)

        # Check cache first
        conn = sqlite3.connect(self.cache_path)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT response_data, headers, status_code, timestamp FROM http_cache WHERE url_hash = ?",
            (url_hash,)
        )
        result = cursor.fetchone()

        if result:
            response_data, headers_json, status_code, timestamp = result
            if not self._is_expired(timestamp):
                # Return cached response
                conn.close()
                headers = json.loads(headers_json) if headers_json else {}
                return HttpResponse(response_data, headers, status_code, from_cache=True, url=full_url)

        # Cache miss or expired - make actual request
        try:
            response_data = make_http_request(full_url, timeout=timeout)
            status_code = 200  # make_http_request only returns data on success
            headers = {}  # Simple implementation doesn't capture headers

            # Store in cache
            cursor.execute("""
                INSERT OR REPLACE INTO http_cache
                (url_hash, url, response_data, headers, status_code, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (url_hash, full_url, response_data, json.dumps(headers), status_code, time_module.time()))
            conn.commit()

        except Exception as e:
            conn.close()
            # Re-raise as requests-compatible exception
            raise Exception(f"HTTP request failed: {e}")

        conn.close()
        return HttpResponse(response_data, headers, status_code, from_cache=False, url=full_url)

def make_json_request(url, method='GET', data=None, headers=None, timeout=30):
    """Make HTTP request and return JSON response or None for 404s"""
    if headers is None:
        headers = {}

    # Set default headers for JSON requests
    headers.setdefault('User-Agent', 'MyBGG/1.0')
    headers.setdefault('Accept', 'application/json')

    try:
        if method.upper() == 'GET':
            response_data = make_http_request(url, timeout=timeout, headers=headers)
        else:
            # For POST requests
            if isinstance(data, dict):
                if headers.get('Content-Type') == 'application/x-www-form-urlencoded':
                    # Form data
                    data = urllib.parse.urlencode(data).encode('utf-8')
                else:
                    # JSON data
                    data = json.dumps(data).encode('utf-8')
                    headers['Content-Type'] = 'application/json'

            # Create request with proper headers
            request = urllib.request.Request(url, data=data, headers=headers)
            request.get_method = lambda: method.upper()

            with urllib.request.urlopen(request, timeout=timeout) as response:
                response_data = response.read()

                # Check if response is gzip compressed
                if response.info().get('Content-Encoding') == 'gzip':
                    response_data = gzip.decompress(response_data)

        # Parse JSON response
        if response_data:
            content = response_data.decode('utf-8')
            if content.strip():
                return json.loads(content)
        return {}

    except urllib.error.HTTPError as e:
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
    except urllib.error.URLError as e:
        raise Exception(f"HTTP request failed: {e}")


def make_form_post(url, data, headers=None, timeout=30):
    """Make HTTP POST request with form data"""
    if headers is None:
        headers = {}

    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    return make_json_request(url, 'POST', data, headers, timeout)
