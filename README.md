# fhir-works-on-aws-persistence-ddb

## Purpose

Please visit [fhir-works-on-aws-deployment](https://github.com/awslabs/fhir-works-on-aws-deployment) for overall vision of the project and for more context.

This package is an implementation of the persistence components of the [FHIR Works interface](https://github.com/awslabs/fhir-works-on-aws-interface). It is responsible for executing CRUD based requests from the router by proxying the requests to an Integration Transform microservice. 

The Integration Transform should implement authentication by using API Gateway [resource policy](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies-examples.html#apigateway-resource-policies-cross-account-example).
 
 The Integration Transform should also implement the persistence APIs as defined [here](https://github.com/awslabs/fhir-works-on-aws-interface/blob/mainline/openapi.yaml). Routes that should be implemented
- POST `/persistence/{resourceType}`
- GET `/persistence/{resourceType}/{id}`
- PUT `/persistence/{resourceType}/{id}`
- DELETE `/persistence/{resourceType}/{id}`
 
For more details about the Integration Transform and how to set it up, please refer to [here](TODO: Get url of repo from Bakha for `fhir-hl7v2-integration-transform`)

To use and deploy `fhir-works-on-aws-persistence-facade` (with the other 'out of the box' components) please follow the overall [README in the API branch](https://github.com/awslabs/fhir-works-on-aws-deployment/tree/api).

## Usage

For usage please add this package to your `package.json` file and install as a dependency. For usage examples please see the deployment component's [package.json](https://github.com/awslabs/fhir-works-on-aws-deployment/blob/mainline/package.json)

## Dependency tree

This package is dependent on:

- [interface component](https://github.com/awslabs/fhir-works-on-aws-interface)
  - This package defines the interface we are trying to use
- [deployment component](https://github.com/awslabs/fhir-works-on-aws-deployment)
  - This package deploys this and all the default components

## Known issues

For known issues please track the issues on the GitHub repository

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.
