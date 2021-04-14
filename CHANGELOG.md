# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [3.3.2](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.3.1...v3.3.2) (2021-04-14)


### Bug Fixes

* return the newly create meta field from bundle processer ([#65](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/65)) ([a2b5206](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/a2b5206d353c25d464e5290d08d375cb1b6d806e))

### [3.3.1](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.3.0...v3.3.1) (2021-04-09)


### Bug Fixes

* don't overwrite meta param in Resource update/create ([#62](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/62)) ([e913c71](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/e913c711c842d922a9aa1902b6705d240af6ad68))
* Only add customUserAgent when code is running on AWS, not when code is running locally ([#61](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/61)) ([c304ffd](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/c304ffd5b1a5d7bf1f9dc5bc2e1088859f4a4968))

## [3.3.0](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.2.1...v3.3.0) (2021-03-26)


### Features

* add support for Update as Create ([#57](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/57)) ([14a254e](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/14a254e7c290b459660506c637de4601a0c36aa8))

### [3.2.1](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.2.0...v3.2.1) (2021-02-08)


### Bug Fixes

* match on resourceType as well as id when executing Read/VRead/DeleteVersionedRes operations ([#51](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/51)) ([4f433d2](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/4f433d2eacdd81c25bdc6e5a2d5e9ea755a33204))
* resolve vid and meta attribute mismatch on concurrent Update requests ([#53](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/53)) ([2ecc1cd](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/2ecc1cd894c9b10b984598f654654a92a1ae5c50))

## [3.2.0](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.1.0...v3.2.0) (2021-01-27)


### Features

* Change ES mapping for keyword parameters ([#48](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/48)) ([1a72433](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/1a72433817752e707af9ea52508b083415149ecc))

## [3.1.0](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/compare/v3.0.0...v3.1.0) (2021-01-20)


### Features

* Add reference to data model ([#44](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/44)) ([7a74313](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/7a74313e88b8620346791d865b35787914889306))


### Bug Fixes

* We no longer need to store presignedS3Urls as they are now dynamically generated when a user request for the S3 files ([#42](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/issues/42)) ([823fb57](https://github.com/awslabs/fhir-works-on-aws-persistence-ddb/commit/823fb573e29a37ba2c83f1c4c33e2cdd1cfef449))

## [3.0.0] - 2020-11-10

### Added
- Support for DB export by implementing BulkDataAccess interfaces in `fhir-works-on-aws-interface` v3.0.0

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
