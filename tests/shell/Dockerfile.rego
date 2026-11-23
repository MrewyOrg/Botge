package docker

# METADATA
# description: Allows the local test Dockerfile and digest-pinned Docker Hardened Debian images.
# scope: rule
default allow := false

allow if input.local

allow if {
	input.image.fullRepo == "dhi.io/debian-base"
	input.image.isCanonical
}

# METADATA
# description: Reports whether a build input satisfies the shell test image policy.
# scope: document
# entrypoint: true
decision := {"allow": allow}
