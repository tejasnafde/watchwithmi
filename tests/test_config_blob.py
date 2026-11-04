"""WATCHWITHMI_CONFIG: one JSON secret expanded into env vars at import."""

import json

import pytest

from app.config import CONFIG_BLOB_ENV, load_config_blob


def test_expands_every_key():
    env = {CONFIG_BLOB_ENV: json.dumps({"SECRET_KEY": "s", "YOUTUBE_API_KEY": "y"})}
    load_config_blob(env)
    assert env["SECRET_KEY"] == "s"
    assert env["YOUTUBE_API_KEY"] == "y"


def test_existing_env_var_wins():
    env = {CONFIG_BLOB_ENV: json.dumps({"SECRET_KEY": "from-blob"}), "SECRET_KEY": "explicit"}
    load_config_blob(env)
    assert env["SECRET_KEY"] == "explicit"


def test_absent_is_a_no_op_locally():
    env = {"OTHER": "x"}
    load_config_blob(env)
    assert env == {"OTHER": "x"}


def test_absent_on_cloud_run_raises():
    with pytest.raises(RuntimeError, match=CONFIG_BLOB_ENV):
        load_config_blob({"K_SERVICE": "watchwithmi-api"})


def test_malformed_json_raises():
    with pytest.raises(json.JSONDecodeError):
        load_config_blob({CONFIG_BLOB_ENV: "{not json"})


def test_non_object_raises():
    with pytest.raises(ValueError):
        load_config_blob({CONFIG_BLOB_ENV: '"just a string"'})
