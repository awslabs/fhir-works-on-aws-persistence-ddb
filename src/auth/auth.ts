export default interface Auth {
    // Hook into axios and intercept requests to add Auth tokens
    // https://masteringjs.io/tutorials/axios/interceptors
    initialize(): void;
}
