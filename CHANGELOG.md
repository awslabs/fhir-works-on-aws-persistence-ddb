# Changelog

All notable changes to this project will be documented in this file.
## [3.0.0] - 2020-11-10
- feat: Add support for Bulk Export by implementing BulkDataAccess in `fhir-works-on-aws-interface` v3.0.0

## [2.0.1] - 2020-10-31
- chore: Upgrade fhir-works-on-aws-interface dependency

## [2.0.0] - 2020-08-31

### Added

- feat: Assume that the Resource DDB sort key is a number not a String
  - BREAKING CHANGE: This change will not be successful if sort key is still a String

## [1.1.0] - 2020-08-31

### Added

- feat: X-Ray integration

## [1.0.0] - 2020-08-31

### Added

- Initial launch! :rocket:
