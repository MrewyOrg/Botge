package docker

# METADATA
# description: Allows Botge sources, pinned Docker Hardened Images and the SBOM scanner.
# scope: rule
default allow := false

allow if input.local

allow if {
	input.git.host == "github.com"
	input.git.remote == "https://github.com/MrewyOrg/Botge.git"
}

allow if {
	input.image.fullRepo in {"dhi.io/golang", "dhi.io/node", "dhi.io/static"}
	input.image.isCanonical
}

allow if input.image.fullRepo == "docker.io/docker/buildkit-syft-scanner"

# METADATA
# description: Reports whether the build input satisfies the source policy.
# scope: document
# entrypoint: true
decision := {"allow": allow}
