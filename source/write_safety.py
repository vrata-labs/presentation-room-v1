"""Output guards for versioned authoring entry points; no Blender dependency."""

import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parent.parent


def assert_output(path, scratch=False, root=ROOT):
    root = Path(root).resolve()
    path = Path(os.path.abspath(path))
    if not path.is_relative_to(root) or path == root:
        raise RuntimeError("output_outside_repository")
    relative = path.relative_to(root)
    allowed = relative.parts[0] == "build" and len(relative.parts) > 1
    if not scratch:
        allowed = allowed or (relative.parts[:3] == ("source", "releases", "0.3.0") and len(relative.parts) > 3)
    if not allowed:
        raise RuntimeError("output_path_forbidden")
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise RuntimeError("output_symlink_forbidden")
    name = relative.as_posix()
    head = subprocess.run(["git", "ls-tree", "--name-only", "HEAD", "--", name], cwd=root, capture_output=True, text=True)
    if head.returncode != 0:
        raise RuntimeError("git_head_output_query_failed")
    index = subprocess.run(["git", "ls-files", "--error-unmatch", "--", name], cwd=root, capture_output=True, text=True)
    if index.returncode not in (0, 1):
        raise RuntimeError("git_index_output_query_failed")
    if head.stdout.strip() or index.returncode == 0:
        raise RuntimeError("tracked_output_forbidden")
    return path
