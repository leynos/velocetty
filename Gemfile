# frozen_string_literal: true

source 'https://rubygems.org'

# FPM is a Ruby gem for building rpm, deb, and pacman packages.
# Pinned for reproducible builds; update periodically.
#
# 1.16.0 is the first release that passes `--buildroot` to rpmbuild. RPM 6
# (Ubuntu 26.04, and therefore the ubuntu-latest runner) ignores the legacy
# `BuildRoot:` spec tag that earlier fpm versions relied on, so it looked for
# the staged payload in its own default buildroot and aborted with "File not
# found" before compression was even reached.
gem 'fpm', '1.16.0'
