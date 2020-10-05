export default interface Auth {
    // Hook into axios and intercept requests
    initialize(): void;
}
